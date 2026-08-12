import type { PositionRecord } from "./db";
import { updatePositionsMarketData } from "./db";
import {
  clearMarketDataCache,
  getGldOptionQuotes,
  getGldPrice,
  getGoldPrice,
  getXautOptionTickers,
  getXautSpotPrice,
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

function findXautTicker(position: PositionRecord, tickers: Awaited<ReturnType<typeof getXautOptionTickers>>) {
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

export async function refreshPositionMarketData(userId: number, positions: PositionRecord[]) {
  clearMarketDataCache();
  const gldPositions = positions.filter(position => position.underlying === "GLD");
  const [xautTickers, gldQuotes, xautSpot, gldSpot, xauSpot] = await Promise.all([
    getXautOptionTickers(),
    getGldOptionQuotes(
      [...new Set(gldPositions.map(position => position.expiry))],
      gldPositions.map(position => ({ expiry: position.expiry, strike: Number(position.strike), optionType: position.optionType })),
    ),
    getXautSpotPrice(),
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
    if (position.underlying === "XAUT") {
      const ticker = findXautTicker(position, xautTickers);
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
    const quantity = Number(position.quantity);
    const contractMultiplier = numberOrNull(position.contractMultiplier) ?? (position.underlying === "GLD" ? 100 : 1);
    const underlyingPrice = position.underlying === "GLD" ? (gldSpot?.price ?? 0) : (xautSpot?.price ?? 0);
    const xauPrice = xauSpot?.price ?? xautSpot?.price ?? 0;
    const multiplierXau = numberOrNull(position.multiplierXau) ?? (underlyingPrice > 0 && xauPrice > 0 ? underlyingPrice / xauPrice : position.underlying === "XAUT" ? 1 : null);
    const entryValue = Number(position.entryPrice) * quantity * contractMultiplier;
    const entryCost = entryValue + Number(position.fee);
    const marketValue = quote.markPrice * quantity * contractMultiplier;
    const upl = marketValue - entryCost;
    const totalDelta = multiplierXau === null ? null : quote.delta * quantity * contractMultiplier * multiplierXau;
    const totalGamma = multiplierXau === null ? null : quote.gamma * quantity * contractMultiplier * multiplierXau ** 2;
    const totalTheta = quote.theta * quantity * contractMultiplier;
    const totalVega = quote.vega * quantity * contractMultiplier;
    updates.push({ id: position.id, data: {
      importedMarkPrice: stringNumber(quote.markPrice), markIv: stringNumber(quote.markIv), bid1Price: stringNumber(quote.bid), ask1Price: stringNumber(quote.ask),
      marketQuoteTime: new Date(quote.timestamp).toISOString(), marketSource: quote.source, lastMarketRefreshAt: refreshedAt,
      openInterest: stringNumber(quote.openInterest), optionVolume: stringNumber(quote.volume), entryDelta: stringNumber(quote.delta) ?? position.entryDelta,
      unitGamma: stringNumber(quote.gamma), unitTheta: stringNumber(quote.theta), unitVega: stringNumber(quote.vega),
      multiplierXau: stringNumber(multiplierXau) ?? position.multiplierXau, importedMarketValue: stringNumber(marketValue), entryValue: stringNumber(entryValue),
      importedEntryCost: stringNumber(entryCost), importedUnrealizedPnl: stringNumber(upl), importedUnrealizedPnlPct: stringNumber(entryCost === 0 ? null : upl / entryCost),
      importedTotalDeltaXau: stringNumber(totalDelta), importedTotalGammaXau: stringNumber(totalGamma), importedTotalThetaUsdDay: stringNumber(totalTheta), importedTotalVegaUsdVol: stringNumber(totalVega),
      dataStatus: statusFor(quote),
    } });
  }
  const updated = await updatePositionsMarketData(userId, updates);
  return { updated, missing, total: positions.length, refreshedAt, sources: [...sources], spots: { xaut: xautSpot, gld: gldSpot, xau: xauSpot } };
}
