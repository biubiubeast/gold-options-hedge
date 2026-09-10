import {
  estimateGammaVolatility,
  nearestClose,
  type GammaStrikeBook,
  type OptionProduct,
  type ResearchKline,
} from "./maxPainResearch";

/** These are scenarios, not inferred dealer inventories. Call/Put is not a sign. */
export const GAMMA_MODELS = [
  {
    id: "call-long-put-short",
    label: "假设 Call 正 / Put 负",
    call: 1,
    put: -1,
  },
  {
    id: "call-short-put-long",
    label: "假设 Call 负 / Put 正",
    call: -1,
    put: 1,
  },
  { id: "all-long", label: "假设全部 Long Gamma", call: 1, put: 1 },
  { id: "all-short", label: "假设全部 Short Gamma", call: -1, put: -1 },
] as const;
export type GammaModel = (typeof GAMMA_MODELS)[number]["id"];
export const GAMMA_FLIP_SCAN = {
  lower: 0.5,
  upper: 1.5,
  intervals: 1600,
  toleranceUsd: 0.01,
} as const;
export interface GammaBand {
  lower: number;
  peak: number;
  upper: number;
}
export interface SignedGammaSnapshot {
  date: string;
  timestamp: number;
  validUntil: number;
  maturity: string;
  product: OptionProduct;
  model: GammaModel;
  spot: number;
  volatility: number;
  volatilityReturns: number;
  volatilityFallback: boolean;
  volatilityFloor: boolean;
  positiveGamma: number;
  negativeGamma: number;
  netGamma: number;
  positiveBand?: GammaBand;
  negativeBand?: GammaBand;
  flips: number[];
  nearestFlip?: number;
  searchLower: number;
  searchUpper: number;
  flipStatus: "found" | "none-in-range" | "balanced";
}

/** Percentile band of nonnegative weights, not a support/resistance interval. */
function band(
  rows: Array<{ strike: number; weight: number }>
): GammaBand | undefined {
  const sorted = rows
    .filter(r => r.weight > 0)
    .sort((a, b) => a.strike - b.strike);
  if (!sorted.length) return undefined;
  const total = sorted.reduce((s, r) => s + r.weight, 0);
  const quantile = (p: number) => {
    let cumulative = 0;
    return sorted.find(r => {
      cumulative += r.weight;
      return cumulative >= p * total;
    })!.strike;
  };
  return {
    lower: quantile(0.2),
    upper: quantile(0.8),
    peak: sorted.reduce((a, b) => (a.weight >= b.weight ? a : b)).strike,
  };
}

/**
 * Fixed t, expiry, OI and RV. Reprice Gamma at each hypothetical S (sticky RV).
 * Dollar delta change for a 1% move: Gamma * signed OI * 1 BTC * S² * 0.01.
 * BTC and USDC books are NEVER combined. USD-equivalent BS is an approximation,
 * not Deribit's BTC-numeraire Greeks; USDC dollar display assumes parity.
 */
export function calculateSignedGamma(
  date: string,
  book: GammaStrikeBook,
  hourlyKlines: ResearchKline[],
  model: GammaModel
): SignedGammaSnapshot | null {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  const expiry = Date.parse(`${book.maturity}T08:00:00Z`);
  const spot = nearestClose(hourlyKlines, timestamp);
  if (!spot || !Number.isFinite(expiry) || expiry <= timestamp) return null;
  const signs = GAMMA_MODELS.find(m => m.id === model)!;
  const estimate = estimateGammaVolatility(hourlyKlines, timestamp);
  const T = Math.max((expiry - timestamp) / (365 * 86_400_000), 1 / (365 * 24));
  const sigma = estimate.volatility;
  const v = sigma * Math.sqrt(T);
  const rows = book.strikes
    .filter(
      r =>
        Number.isFinite(r.strike) &&
        r.strike > 0 &&
        Number.isFinite(r.callOi) &&
        r.callOi >= 0 &&
        Number.isFinite(r.putOi) &&
        r.putOi >= 0
    )
    .map(r => ({
      strike: r.strike,
      oi: signs.call * r.callOi + signs.put * r.putOi,
    }));
  if (!rows.length) return null;
  const d1 = (S: number, K: number) =>
    (Math.log(S / K) + 0.5 * sigma * sigma * T) / v;
  const exposures = rows.map(r => ({
    strike: r.strike,
    value:
      ((r.oi * Math.exp(-0.5 * d1(spot, r.strike) ** 2)) /
        (Math.sqrt(2 * Math.PI) * spot * v)) *
      spot ** 2 *
      0.01,
  }));
  const positiveGamma = exposures.reduce((s, r) => s + Math.max(r.value, 0), 0);
  const negativeGamma = exposures.reduce((s, r) => s + Math.min(r.value, 0), 0);
  // Group equal strikes before the scan so perfectly offset positions have no Flip.
  const weights = new Map<number, number>();
  for (const r of rows)
    weights.set(r.strike, (weights.get(r.strike) ?? 0) + r.oi);
  const nonzero = [...weights].filter(([, oi]) => oi !== 0);
  // Common positive Gamma factor cancels when finding sign/zeros. Log scaling
  // prevents far-OTM underflow to zero from masquerading as a Gamma Flip.
  const normalizedNet = (S: number) => {
    const values = nonzero.map(([K, oi]) => ({
      oi,
      log: -0.5 * d1(S, K) ** 2,
    }));
    const maxLog = Math.max(...values.map(r => r.log));
    let signed = 0,
      absolute = 0;
    for (const r of values) {
      const w = r.oi * Math.exp(r.log - maxLog);
      signed += w;
      absolute += Math.abs(w);
    }
    return signed / absolute;
  };
  const searchLower = spot * GAMMA_FLIP_SCAN.lower,
    searchUpper = spot * GAMMA_FLIP_SCAN.upper;
  const flips: number[] = [];
  let previous: { S: number; value: number } | undefined;
  if (nonzero.length)
    for (let i = 0; i <= GAMMA_FLIP_SCAN.intervals; i++) {
      const S =
        searchLower *
        (searchUpper / searchLower) ** (i / GAMMA_FLIP_SCAN.intervals);
      const value = normalizedNet(S);
      // An exact zero requires opposite signs on its two sides, not just a touch.
      if (value === 0) continue;
      if (previous && Math.sign(previous.value) !== Math.sign(value)) {
        let lo = previous.S,
          hi = S,
          leftSign = Math.sign(previous.value);
        for (let n = 0; n < 64 && hi - lo > GAMMA_FLIP_SCAN.toleranceUsd; n++) {
          const mid = (lo + hi) / 2,
            f = normalizedNet(mid);
          if (f === 0) {
            lo = hi = mid;
            break;
          }
          if (Math.sign(f) === leftSign) lo = mid;
          else hi = mid;
        }
        const root = (lo + hi) / 2;
        if (
          !flips.length ||
          Math.abs(root - flips.at(-1)!) > GAMMA_FLIP_SCAN.toleranceUsd * 2
        )
          flips.push(root);
      }
      previous = { S, value };
    }
  return {
    date,
    timestamp,
    validUntil: Math.min(timestamp + 86_400_000, expiry),
    maturity: book.maturity,
    product: book.product,
    model,
    spot,
    volatility: sigma,
    volatilityReturns: estimate.sampleCount,
    volatilityFallback: estimate.fallback,
    volatilityFloor: estimate.floorApplied,
    positiveGamma,
    negativeGamma,
    netGamma: positiveGamma + negativeGamma,
    positiveBand: band(
      exposures.map(r => ({ strike: r.strike, weight: Math.max(r.value, 0) }))
    ),
    negativeBand: band(
      exposures.map(r => ({ strike: r.strike, weight: Math.max(-r.value, 0) }))
    ),
    flips,
    nearestFlip: [...flips].sort(
      (a, b) => Math.abs(a - spot) - Math.abs(b - spot)
    )[0],
    searchLower,
    searchUpper,
    flipStatus: !nonzero.length
      ? "balanced"
      : flips.length
        ? "found"
        : "none-in-range",
  };
}
