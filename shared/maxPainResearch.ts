/**
 * BTC Max Pain research primitives shared by the Cronus server and browser.
 *
 * Max Pain uses expiry intrinsic value only:
 *   call payout = max(settlement - strike, 0) * call OI
 *   put payout  = max(strike - settlement, 0) * put OI
 * The strike with the smallest total holder payout is the Max Pain strike.
 */

export const OBSERVATION_HOURS = [0, 4, 8, 12, 16, 20] as const;
export const SIGNALPLUS_EARLIEST_VERIFIED_DATE = "2023-05-05";
export const MAX_INTRADAY_QUERY_DAYS = 93;

export type ObservationHour = (typeof OBSERVATION_HOURS)[number];
export type OptionProduct = "combined" | "inverse" | "linear";
export type MaxPainExpiryPolicy = "front" | "daily" | "weekly" | "monthly";
export type ResearchKlineInterval = "1h" | "4h" | "12h" | "1d";

export interface IntradayMaxPainPoint {
  timestamp: number;
  date: string;
  hourUtc: ObservationHour;
  maturity: string;
  product: OptionProduct;
  maxPain: number;
  minimumPayout: number;
  callOi: number;
  putOi: number;
  totalOi: number;
  strikeCount: number;
  sourceTimestamp: number;
}

export interface GammaStrikeBook {
  maturity: string;
  product: OptionProduct;
  strikes: StrikeOi[];
}

/** One on-demand historical OI snapshot with every expiry/strike book. */
export interface SignalPlusStrikeSnapshotResponse {
  date: string;
  hourUtc: ObservationHour;
  timestamp: number;
  provider: "SignalPlus";
  providerHost: string;
  sourceTimestamp: number;
  books: GammaStrikeBook[];
  points: IntradayMaxPainPoint[];
  warnings: string[];
}

export interface SignalPlusDayResponse {
  date: string;
  provider: "SignalPlus";
  providerHost: string;
  points: IntradayMaxPainPoint[];
  gammaBooksAtZero: GammaStrikeBook[];
  missingHours: ObservationHour[];
  warnings: string[];
}

export interface ResearchKline {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketHistoryResponse {
  interval: ResearchKlineInterval;
  displayKlines: ResearchKline[];
  hourlyKlines: ResearchKline[];
  source: "Coinbase Exchange" | "OKX Spot" | "Binance Spot";
  symbol: "BTC-USD" | "BTC-USDT" | "BTCUSDT";
  attemptedSources: string[];
}

export interface GammaZone {
  date: string;
  maturity: string;
  product: OptionProduct;
  spot: number;
  lowerStrike: number;
  peakStrike: number;
  upperStrike: number;
  grossGamma: number;
  volatility: number;
  assumption: string;
}

export interface BacktestRow {
  date: string;
  timestamp: number;
  maxPain: number;
  price24hBefore: number;
  priceAtObservation: number;
  price24hAfter?: number;
  backwardMovePct: number;
  backwardTowardPain: boolean;
  backwardConvergencePct: number;
  forwardReturnPct?: number;
  forwardTowardPain?: boolean;
  forwardConvergencePct?: number;
  captureRatio?: number;
}

export interface BacktestSummary {
  sampleSize: number;
  backwardHitRate: number;
  meanBackwardMovePct: number;
  meanBackwardConvergencePct: number;
  forwardSampleSize: number;
  forwardHitRate?: number;
  meanForwardReturnPct?: number;
  meanForwardConvergencePct?: number;
  pearsonGapVsForwardReturn?: number;
  spearmanGapVsForwardReturn?: number;
}

export type StrikeOi = { strike: number; callOi: number; putOi: number };

/** Merge several expiry books at strike level before calculating Max Pain. */
export function mergeStrikeBooks(books: GammaStrikeBook[]): StrikeOi[] {
  const merged = new Map<number, StrikeOi>();
  for (const book of books) {
    for (const source of book.strikes) {
      const row = merged.get(source.strike) ?? {
        strike: source.strike,
        callOi: 0,
        putOi: 0,
      };
      row.callOi += source.callOi;
      row.putOi += source.putOi;
      merged.set(source.strike, row);
    }
  }
  return [...merged.values()].sort((left, right) => left.strike - right.strike);
}

/** Calculate the complete payout curve and keep the lower strike on a tie. */
export function calculateMaxPain(strikes: StrikeOi[]) {
  const valid = strikes.filter(
    row =>
      Number.isFinite(row.strike) &&
      row.strike > 0 &&
      Number.isFinite(row.callOi) &&
      row.callOi >= 0 &&
      Number.isFinite(row.putOi) &&
      row.putOi >= 0
  );
  const settlementPrices = [...new Set(valid.map(row => row.strike))].sort(
    (left, right) => left - right
  );
  if (!settlementPrices.length) return null;
  const curve = settlementPrices.map(settlementPrice => ({
    settlementPrice,
    payout: valid.reduce(
      (sum, row) =>
        sum +
        Math.max(settlementPrice - row.strike, 0) * row.callOi +
        Math.max(row.strike - settlementPrice, 0) * row.putOi,
      0
    ),
  }));
  const minimum = curve.reduce((best, point) =>
    point.payout < best.payout ? point : best
  );
  return { maxPain: minimum.settlementPrice, payout: minimum.payout, curve };
}

/** Build one six-hour observation from one expiry/product strike book. */
export function calculateIntradayPoint(
  timestamp: number,
  maturity: string,
  product: OptionProduct,
  strikes: StrikeOi[],
  sourceTimestamp: number
): IntradayMaxPainPoint | null {
  const result = calculateMaxPain(strikes);
  if (!result) return null;
  const callOi = strikes.reduce((sum, row) => sum + row.callOi, 0);
  const putOi = strikes.reduce((sum, row) => sum + row.putOi, 0);
  const instant = new Date(timestamp);
  return {
    timestamp,
    date: instant.toISOString().slice(0, 10),
    hourUtc: instant.getUTCHours() as ObservationHour,
    maturity,
    product,
    maxPain: result.maxPain,
    minimumPayout: result.payout,
    callOi,
    putOi,
    totalOi: callOi + putOi,
    strikeCount: strikes.length,
    sourceTimestamp,
  };
}

function isLastFriday(date: Date) {
  if (date.getUTCDay() !== 5) return false;
  return (
    new Date(date.getTime() + 7 * 86_400_000).getUTCMonth() !==
    date.getUTCMonth()
  );
}

/** Select the nearest unexpired expiry independently at every observation. */
export function selectIntradayExpiry(
  points: IntradayMaxPainPoint[],
  policy: MaxPainExpiryPolicy
) {
  const groups = new Map<string, IntradayMaxPainPoint[]>();
  for (const point of points) {
    const key = `${point.timestamp}|${point.product}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  const selected: IntradayMaxPainPoint[] = [];
  for (const bucket of groups.values()) {
    const snapshot = bucket[0].timestamp;
    const eligible = bucket
      .filter(point => {
        const expiry = Date.parse(`${point.maturity}T08:00:00Z`);
        if (!Number.isFinite(expiry) || expiry <= snapshot) return false;
        const expiryDate = new Date(expiry);
        if (policy === "daily") return expiry - snapshot <= 32 * 3_600_000;
        if (policy === "weekly") return expiryDate.getUTCDay() === 5;
        if (policy === "monthly") return isLastFriday(expiryDate);
        return true;
      })
      .sort((left, right) => left.maturity.localeCompare(right.maturity));
    if (eligible[0]) selected.push(eligible[0]);
  }
  return selected.sort((left, right) => left.timestamp - right.timestamp);
}

/** Return the latest fully closed hourly candle no more than two hours away. */
export function nearestClose(klines: ResearchKline[], timestamp: number) {
  let latest: ResearchKline | undefined;
  for (const kline of klines) {
    if (
      kline.closeTime <= timestamp &&
      (!latest || kline.closeTime > latest.closeTime)
    ) {
      latest = kline;
    }
  }
  return latest && timestamp - latest.closeTime <= 2 * 3_600_000
    ? latest.close
    : undefined;
}

function normalPdf(value: number) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function realizedVolatility(klines: ResearchKline[], timestamp: number) {
  const closes = klines
    .filter(
      kline =>
        kline.openTime <= timestamp &&
        kline.openTime >= timestamp - 30 * 86_400_000
    )
    .map(kline => kline.close);
  if (closes.length < 24) return 0.6;
  const returns = closes
    .slice(1)
    .map((value, index) => Math.log(value / closes[index]));
  const average =
    returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    Math.max(returns.length - 1, 1);
  return Math.max(Math.sqrt(variance * 24 * 365), 0.05);
}

/**
 * Gross Gamma concentration proxy. OI has no holder direction and the historic
 * feed has no IV, so this must never be labelled signed dealer GEX.
 */
export function calculateGrossGammaZone(
  date: string,
  book: GammaStrikeBook,
  hourlyKlines: ResearchKline[]
): GammaZone | null {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  const spot = nearestClose(hourlyKlines, timestamp);
  if (!spot) return null;
  const expiry = Date.parse(`${book.maturity}T08:00:00Z`);
  const years = Math.max(
    (expiry - timestamp) / (365 * 86_400_000),
    1 / (365 * 24)
  );
  const volatility = realizedVolatility(hourlyKlines, timestamp);
  const weighted = book.strikes
    .map(row => {
      const d1 =
        (Math.log(spot / row.strike) + 0.5 * volatility ** 2 * years) /
        (volatility * Math.sqrt(years));
      const gamma = normalPdf(d1) / (spot * volatility * Math.sqrt(years));
      return {
        strike: row.strike,
        value: (row.callOi + row.putOi) * spot ** 2 * gamma * 0.01,
      };
    })
    .filter(row => Number.isFinite(row.value) && row.value > 0)
    .sort((left, right) => left.strike - right.strike);
  if (!weighted.length) return null;
  const total = weighted.reduce((sum, row) => sum + row.value, 0);
  const peak = weighted.reduce((best, row) =>
    row.value > best.value ? row : best
  );
  let cumulative = 0;
  let lower = weighted[0].strike;
  let upper = weighted.at(-1)!.strike;
  for (const row of weighted) {
    cumulative += row.value;
    if (cumulative >= total * 0.2) {
      lower = row.strike;
      break;
    }
  }
  cumulative = 0;
  for (const row of weighted) {
    cumulative += row.value;
    if (cumulative >= total * 0.8) {
      upper = row.strike;
      break;
    }
  }
  return {
    date,
    maturity: book.maturity,
    product: book.product,
    spot,
    lowerStrike: lower,
    peakStrike: peak.strike,
    upperStrike: upper,
    grossGamma: total,
    volatility,
    assumption:
      "Black-Scholes、30日历史实现波动率、Call+Put OI；是毛 Gamma 集中度，不代表做市商净 Gamma 方向。",
  };
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
}

function correlation(left: number[], right: number[]) {
  if (left.length < 3 || left.length !== right.length) return undefined;
  const leftMean = mean(left)!;
  const rightMean = mean(right)!;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftSquares += a * a;
    rightSquares += b * b;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator ? numerator / denominator : undefined;
}

function ranks(values: number[]) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length).fill(0);
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value)
      end++;
    const rank = (start + end - 1) / 2 + 1;
    for (let index = start; index < end; index++)
      result[sorted[index].index] = rank;
    start = end;
  }
  return result;
}

/** Backward description plus a separate, no-lookahead forward 24-hour test. */
export function backtestMaxPain(
  points: IntradayMaxPainPoint[],
  hourlyKlines: ResearchKline[],
  hourUtc: ObservationHour
): { rows: BacktestRow[]; summary: BacktestSummary } {
  const rows = points
    .filter(point => point.hourUtc === hourUtc)
    .flatMap(point => {
      const before = nearestClose(hourlyKlines, point.timestamp - 86_400_000);
      const at = nearestClose(hourlyKlines, point.timestamp);
      const after = nearestClose(hourlyKlines, point.timestamp + 86_400_000);
      if (before === undefined || at === undefined) return [];
      const initialDistance = Math.abs(before - point.maxPain);
      const row: BacktestRow = {
        date: point.date,
        timestamp: point.timestamp,
        maxPain: point.maxPain,
        price24hBefore: before,
        priceAtObservation: at,
        price24hAfter: after,
        backwardMovePct: ((at - before) / before) * 100,
        backwardTowardPain: Math.abs(at - point.maxPain) < initialDistance,
        backwardConvergencePct: initialDistance
          ? ((initialDistance - Math.abs(at - point.maxPain)) /
              initialDistance) *
            100
          : 0,
      };
      if (after !== undefined) {
        const forwardDistance = Math.abs(at - point.maxPain);
        row.forwardReturnPct = ((after - at) / at) * 100;
        row.forwardTowardPain =
          Math.abs(after - point.maxPain) < forwardDistance;
        row.forwardConvergencePct = forwardDistance
          ? ((forwardDistance - Math.abs(after - point.maxPain)) /
              forwardDistance) *
            100
          : 0;
        row.captureRatio =
          point.maxPain !== at ? (after - at) / (point.maxPain - at) : 0;
      }
      return [row];
    });
  const forward = rows.filter(row => row.forwardReturnPct !== undefined);
  const gaps = forward.map(
    row => (row.maxPain - row.priceAtObservation) / row.priceAtObservation
  );
  const returns = forward.map(row => row.forwardReturnPct! / 100);
  const forwardFlags = forward.map(row => Number(row.forwardTowardPain));
  return {
    rows,
    summary: {
      sampleSize: rows.length,
      backwardHitRate:
        (mean(rows.map(row => Number(row.backwardTowardPain))) ?? 0) * 100,
      meanBackwardMovePct: mean(rows.map(row => row.backwardMovePct)) ?? 0,
      meanBackwardConvergencePct:
        mean(rows.map(row => row.backwardConvergencePct)) ?? 0,
      forwardSampleSize: forward.length,
      forwardHitRate: forwardFlags.length
        ? mean(forwardFlags)! * 100
        : undefined,
      meanForwardReturnPct: mean(forward.map(row => row.forwardReturnPct!)),
      meanForwardConvergencePct: mean(
        forward.map(row => row.forwardConvergencePct!)
      ),
      pearsonGapVsForwardReturn: correlation(gaps, returns),
      spearmanGapVsForwardReturn: correlation(ranks(gaps), ranks(returns)),
    },
  };
}
