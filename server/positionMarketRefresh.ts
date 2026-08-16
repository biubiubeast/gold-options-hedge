import type { PositionRecord } from "./db";
import { updatePositionsMarketData } from "./db";
import {
  DEFAULT_GLD_CONTRACT_MULTIPLIER,
  DEFAULT_XAUT_CONTRACT_MULTIPLIER,
  evaluateNamedFormula,
  resolveGldContractMultiplier,
  resolveGldXauMultiplier,
  resolveXautContractMultiplier,
  resolveXautXauMultiplier,
} from "@shared/formulaEngine";
import { DEFAULT_FORMULAS, type FormulaLike } from "@shared/marketTypes";
import {
  clearMarketDataCache,
  getGldOptionQuotes,
  getGldPrice,
  getGoldPrice,
  getXautOptionTickers,
  getXautSpotPrice,
  getBtcOptionTickers,
  getBtcSpotPrice,
  type GldOptionQuote,
} from "./marketData";

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const stringNumber = (value: number | null): string | null => value === null || !Number.isFinite(value) ? null : Number(value.toFixed(10)).toString();
const keyOf = (position: Pick<PositionRecord, "expiry" | "strike" | "optionType">) => `${position.expiry}|${Number(position.strike)}|${position.optionType}`;

function bybitExpiry(expiry: string): string {
  const [year, month, day] = expiry.split("-").map(Number);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${day}${months[month - 1]}${String(year).slice(2)}`;
}

function findBybitTicker(position: PositionRecord, tickers: Awaited<ReturnType<typeof getXautOptionTickers>>) {
  const expiryToken = bybitExpiry(position.expiry);
  const strike = Number(position.strike);
  const typeToken = position.optionType === "call" ? "C" : "P";
  return tickers.find(ticker => {
    const tokens = ticker.symbol.toUpperCase().split("-");
    return ticker.symbol.toUpperCase().includes(expiryToken)
      && tokens.includes(typeToken)
      && tokens.some(token => Number(token) === strike && token !== "0");
  });
}

type NormalizedQuote = {
  markPrice: number;
  markIv: number;
  bid: number;
  ask: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  timestamp: number;
  source: string;
  openInterest: number | null;
  volume: number | null;
};

function statusFor(quote: NormalizedQuote): PositionRecord["dataStatus"] {
  if (quote.markPrice <= 0 || !quote.source) return "MISSING";
  const age = Math.max(0, Date.now() - quote.timestamp);
  if (age > 60 * 60_000) return "STALE";
  if (age > 15 * 60_000 || quote.source.includes("delayed")) return "STALE";
  if (![quote.delta, quote.gamma, quote.theta, quote.vega].every(Number.isFinite)) return "WARN";
  return "LIVE";
}

function formulaNumber(
  name: string,
  variables: Record<string, number>,
  formulas: readonly FormulaLike[],
  fallback: number,
): number {
  try {
    const value = evaluateNamedFormula(name, variables, formulas, new Set());
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function effectiveContractMultiplier(
  position: PositionRecord,
  formulas: readonly FormulaLike[],
): { value: number; raw: number | null; nonStandard: boolean } {
  const raw = numberOrNull(position.contractMultiplier);
  if (position.underlying === "GLD") {
    const nonStandard = raw !== null && Math.abs(raw - DEFAULT_GLD_CONTRACT_MULTIPLIER) > 1e-9;
    return { value: nonStandard ? raw : resolveGldContractMultiplier(formulas), raw, nonStandard };
  }
  if (position.underlying === "XAUT") {
    const nonStandard = raw !== null && Math.abs(raw - DEFAULT_XAUT_CONTRACT_MULTIPLIER) > 1e-9;
    return { value: nonStandard ? raw : resolveXautContractMultiplier(formulas), raw, nonStandard };
  }
  return { value: raw ?? 1, raw, nonStandard: false };
}

function effectiveMultiplierXau(args: {
  position: PositionRecord;
  nonStandardContract: boolean;
  formulas: readonly FormulaLike[];
  configuredScale?: number | null;
  liveRatio?: number | null;
}): number | null {
  const { position, formulas } = args;
  const imported = numberOrNull(position.multiplierXau);
  if (position.underlying === "GLD") {
    return args.nonStandardContract && imported !== null
      ? imported
      : resolveGldXauMultiplier(formulas, numberOrNull(args.configuredScale) ?? 0.092);
  }
  if (position.underlying === "XAUT") {
    return args.nonStandardContract && imported !== null
      ? imported
      : resolveXautXauMultiplier(formulas, numberOrNull(args.configuredScale) ?? 1);
  }
  return imported
    ?? numberOrNull(args.configuredScale)
    ?? numberOrNull(args.liveRatio)
    ?? null;
}

function formulaDrivenFields(args: {
  position: PositionRecord;
  markPrice: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  contractMultiplier: number;
  multiplierXau: number | null;
  underlyingPrice?: number;
  xauPrice?: number;
  formulas: readonly FormulaLike[];
}) {
  const { position, markPrice, delta, gamma, theta, vega, contractMultiplier, multiplierXau, formulas } = args;
  const quantity = Number(position.quantity);
  const entryPrice = Number(position.entryPrice);
  const fee = Number(position.fee);
  const baseVariables = {
    entryPrice,
    quantity,
    fee,
    markPrice: markPrice ?? 0,
    contractMultiplier,
    delta: delta ?? 0,
    gamma: gamma ?? 0,
    theta: theta ?? 0,
    vega: vega ?? 0,
    spotScale: multiplierXau ?? 0,
    underlyingPrice: args.underlyingPrice ?? 0,
    xauUsdPrice: args.xauPrice ?? 0,
  };
  const entryValue = entryPrice * quantity * contractMultiplier;
  const entryCost = formulaNumber("entry_cost", baseVariables, formulas, entryValue + fee);
  const marketValue = markPrice === null
    ? null
    : formulaNumber("current_value", baseVariables, formulas, markPrice * quantity * contractMultiplier);
  const upl = marketValue === null
    ? null
    : formulaNumber("pnl", { ...baseVariables, entryCost, currentValue: marketValue }, formulas, marketValue - entryCost);
  const totalDelta = multiplierXau === null || delta === null ? null : formulaNumber(
    "total_delta_xau", baseVariables, formulas, delta * quantity * contractMultiplier * multiplierXau,
  );
  const totalGamma = multiplierXau === null || gamma === null ? null : formulaNumber(
    "total_gamma_xau", baseVariables, formulas, gamma * quantity * contractMultiplier * multiplierXau ** 2,
  );
  const totalTheta = theta === null ? null : formulaNumber(
    "total_theta", baseVariables, formulas, theta * quantity * contractMultiplier,
  );
  const totalVega = vega === null ? null : formulaNumber(
    "total_vega", baseVariables, formulas, vega * quantity * contractMultiplier,
  );
  return { entryValue, entryCost, marketValue, upl, totalDelta, totalGamma, totalTheta, totalVega };
}

/** Recomputes persisted formula-derived fields immediately after a formula edit/reset. */
export async function recalculatePositionFormulaData(
  userId: number,
  positions: PositionRecord[],
  customFormulas: readonly FormulaLike[],
) {
  const formulas = customFormulas.length ? customFormulas : DEFAULT_FORMULAS;
  const updates = positions.map(position => {
    const contract = effectiveContractMultiplier(position, formulas);
    const contractMultiplier = contract.value;
    const multiplierXau = effectiveMultiplierXau({ position, nonStandardContract: contract.nonStandard, formulas });
    const fields = formulaDrivenFields({
      position,
      markPrice: numberOrNull(position.importedMarkPrice),
      delta: numberOrNull(position.entryDelta),
      gamma: numberOrNull(position.unitGamma),
      theta: numberOrNull(position.unitTheta),
      vega: numberOrNull(position.unitVega),
      contractMultiplier,
      multiplierXau,
      formulas,
    });
    return { id: position.id, data: {
      multiplierXau: stringNumber(multiplierXau),
      entryValue: stringNumber(fields.entryValue),
      importedEntryCost: stringNumber(fields.entryCost),
      importedMarketValue: stringNumber(fields.marketValue),
      importedUnrealizedPnl: stringNumber(fields.upl),
      importedUnrealizedPnlPct: stringNumber(fields.upl === null || fields.entryCost === 0 ? null : fields.upl / fields.entryCost),
      importedTotalDeltaXau: stringNumber(fields.totalDelta),
      importedTotalGammaXau: stringNumber(fields.totalGamma),
      importedTotalThetaUsdDay: stringNumber(fields.totalTheta),
      importedTotalVegaUsdVol: stringNumber(fields.totalVega),
    } };
  });
  return updatePositionsMarketData(userId, updates);
}

export async function refreshPositionMarketData(
  userId: number,
  positions: PositionRecord[],
  scaleOverrides?: { gldMultiplierXau?: number | null; xautMultiplierXau?: number | null; btcMultiplierXau?: number | null },
  customFormulas: readonly FormulaLike[] = DEFAULT_FORMULAS,
) {
  const formulas = customFormulas.length ? customFormulas : DEFAULT_FORMULAS;
  clearMarketDataCache();
  const gldPositions = positions.filter(position => position.underlying === "GLD");
  const [xautTickers, btcTickers, gldQuotes, xautSpot, btcSpot, gldSpot, xauSpot] = await Promise.all([
    getXautOptionTickers(),
    getBtcOptionTickers(),
    getGldOptionQuotes(
      [...new Set(gldPositions.map(position => position.expiry))],
      gldPositions.map(position => ({ expiry: position.expiry, strike: Number(position.strike), optionType: position.optionType })),
    ),
    getXautSpotPrice(),
    getBtcSpotPrice(),
    getGldPrice(),
    getGoldPrice(),
  ]);
  const gldMap = new Map<string, GldOptionQuote>(gldQuotes.map(quote => [`${quote.expiry}|${quote.strike}|${quote.optionType}`, quote]));
  const refreshedAt = new Date().toISOString();
  const updates: Array<{ id: number; data: Partial<Omit<PositionRecord, "id" | "userId" | "createdAt" | "updatedAt">> }> = [];
  const missing: Array<{ id: number; instrument: string; reason: string }> = [];
  const sources = new Set<string>();

  for (const position of positions) {
    let quote: NormalizedQuote | null = null;
    if (position.underlying === "XAUT" || position.underlying === "BTC") {
      const ticker = findBybitTicker(position, position.underlying === "BTC" ? btcTickers : xautTickers);
      if (ticker) quote = {
        markPrice: Number(ticker.markPrice), markIv: Number(ticker.markIv), bid: Number(ticker.bid1Price), ask: Number(ticker.ask1Price),
        delta: Number(ticker.delta), gamma: Number(ticker.gamma), theta: Number(ticker.theta), vega: Number(ticker.vega),
        timestamp: Number(ticker.timestamp), source: "Bybit V5 realtime", openInterest: numberOrNull(ticker.openInterest), volume: numberOrNull(ticker.volume24h),
      };
    } else {
      const item = gldMap.get(keyOf(position));
      if (item) quote = {
        markPrice: item.markPrice, markIv: item.markIv, bid: item.bid1Price, ask: item.ask1Price,
        delta: item.delta, gamma: item.gamma, theta: item.theta, vega: item.vega,
        timestamp: item.timestamp, source: item.source, openInterest: item.openInterest ?? null, volume: item.volume ?? null,
      };
    }
    if (!quote || !Number.isFinite(quote.markPrice) || quote.markPrice <= 0) {
      missing.push({ id: position.id, instrument: position.instrument ?? `${position.underlying} ${position.expiry} ${position.strike}`, reason: "No matching market quote" });
      updates.push({ id: position.id, data: { dataStatus: "MISSING", lastMarketRefreshAt: refreshedAt } });
      continue;
    }
    sources.add(quote.source);
    const contract = effectiveContractMultiplier(position, formulas);
    const contractMultiplier = contract.value;
    const underlyingPrice = position.underlying === "GLD" ? (gldSpot?.price ?? 0) : position.underlying === "BTC" ? (btcSpot?.price ?? 0) : (xautSpot?.price ?? 0);
    const xauPrice = xauSpot?.price ?? xautSpot?.price ?? 0;
    const configuredScale = position.underlying === "GLD" ? scaleOverrides?.gldMultiplierXau : position.underlying === "BTC" ? scaleOverrides?.btcMultiplierXau : scaleOverrides?.xautMultiplierXau;
    const multiplierXau = effectiveMultiplierXau({
      position,
      nonStandardContract: contract.nonStandard,
      formulas,
      configuredScale,
      liveRatio: underlyingPrice > 0 && xauPrice > 0 ? underlyingPrice / xauPrice : null,
    });
    const fields = formulaDrivenFields({
      position,
      markPrice: quote.markPrice,
      delta: quote.delta,
      gamma: quote.gamma,
      theta: quote.theta,
      vega: quote.vega,
      contractMultiplier,
      multiplierXau,
      underlyingPrice,
      xauPrice,
      formulas,
    });
    updates.push({ id: position.id, data: {
      importedMarkPrice: stringNumber(quote.markPrice), markIv: stringNumber(quote.markIv), bid1Price: stringNumber(quote.bid), ask1Price: stringNumber(quote.ask),
      marketQuoteTime: new Date(quote.timestamp).toISOString(), marketSource: quote.source, lastMarketRefreshAt: refreshedAt,
      openInterest: stringNumber(quote.openInterest), optionVolume: stringNumber(quote.volume), entryDelta: stringNumber(quote.delta) ?? position.entryDelta,
      unitGamma: stringNumber(quote.gamma), unitTheta: stringNumber(quote.theta), unitVega: stringNumber(quote.vega),
      multiplierXau: stringNumber(multiplierXau) ?? position.multiplierXau, importedMarketValue: stringNumber(fields.marketValue), entryValue: stringNumber(fields.entryValue),
      importedEntryCost: stringNumber(fields.entryCost), importedUnrealizedPnl: stringNumber(fields.upl), importedUnrealizedPnlPct: stringNumber(fields.upl === null || fields.entryCost === 0 ? null : fields.upl / fields.entryCost),
      importedTotalDeltaXau: stringNumber(fields.totalDelta), importedTotalGammaXau: stringNumber(fields.totalGamma), importedTotalThetaUsdDay: stringNumber(fields.totalTheta), importedTotalVegaUsdVol: stringNumber(fields.totalVega),
      dataStatus: statusFor(quote),
    } });
  }
  const updated = await updatePositionsMarketData(userId, updates);
  return { updated, missing, total: positions.length, refreshedAt, sources: [...sources], spots: { xaut: xautSpot, btc: btcSpot, gld: gldSpot, xau: xauSpot } };
}
