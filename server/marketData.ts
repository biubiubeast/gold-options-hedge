import type { SpotPrice } from "@shared/marketTypes";

const BYBIT_BASE_URL = "https://api.bybit.com";
const DERIBIT_BASE_URL = "https://www.deribit.com/api/v2";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const TRADIER_BASE_URL = process.env.TRADIER_BASE_URL || "https://api.tradier.com/v1";
const MARKETDATA_BASE_URL = "https://api.marketdata.app/v1";
const CBOE_GLD_CHAIN_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/GLD.json";
const CBOE_GLD_QUOTE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/GLD.json";
const REQUEST_TIMEOUT_MS = 15_000;
const LIVE_CACHE_MS = 5_000;
const OPTION_CACHE_MS = 10_000;

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();
const lastGood = new Map<string, unknown>();

export interface BybitTickerOption {
  symbol: string;
  lastPrice: string;
  markPrice: string;
  indexPrice: string;
  markIv: string;
  underlyingPrice: string;
  bid1Price: string;
  bid1Size: string;
  bid1Iv: string;
  ask1Price: string;
  ask1Size: string;
  ask1Iv: string;
  delta: string;
  gamma: string;
  theta: string;
  vega: string;
  volume24h: string;
  openInterest: string;
  timestamp: number;
}

export interface BybitInstrument {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  optionsType: string;
  deliveryTime: string;
  status: string;
}

export interface GldOptionQuote {
  symbol: string;
  expiry: string;
  strike: number;
  optionType: "call" | "put";
  markPrice: number;
  markIv: number;
  bidIv: number | null;
  askIv: number | null;
  ivSpread: number | null;
  bidIvDerived?: boolean;
  askIvDerived?: boolean;
  expiryTimestamp?: number;
  bid1Price: number;
  ask1Price: number;
  bid1Size: number | null;
  ask1Size: number | null;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  timestamp: number;
  source: "MarketData.app / OPRA" | "Tradier / ORATS" | "Cboe delayed options / OPRA";
  openInterest?: number;
  volume?: number;
  tradeable?: boolean;
  marketAvailable?: boolean;
}

export interface GldOptionChain {
  quotes: GldOptionQuote[];
  spot: number;
  timestamp: number;
  source: string;
  status: "delayed" | "stale";
  delaySeconds: number;
  contractCount: number;
  expiryCount: number;
  strikeCount: number;
}

export interface XautOptionQuote extends Omit<GldOptionQuote, "source"> {
  source: string;
  contractMultiplier?: number;
  premiumCurrency?: string;
}

export interface XautOptionChain extends Omit<GldOptionChain, "quotes" | "status"> {
  quotes: XautOptionQuote[];
  status: "realtime" | "stale";
}

export type BtcOptionQuote = XautOptionQuote;
export type BtcOptionChain = XautOptionChain;
export type EthOptionQuote = XautOptionQuote;
export type EthOptionChain = XautOptionChain;
type BybitOptionBaseCoin = "XAUT" | "BTC" | "ETH";
type DeribitOptionCurrency = "BTC" | "ETH";

export interface DeribitInstrument {
  state: string;
  kind: string;
  instrument_name: string;
  expiration_timestamp: number;
  is_active: boolean;
  contract_size: number;
  strike: number;
  base_currency: string;
  quote_currency: string;
  option_type: "call" | "put";
}

export interface DeribitBookSummary {
  instrument_name: string;
  bid_price: number | null;
  ask_price: number | null;
  mark_price: number | null;
  mark_iv: number | null;
  underlying_price: number | null;
  interest_rate: number | null;
  open_interest: number | null;
  volume: number | null;
  creation_timestamp: number;
  base_currency: string;
  quote_currency: string;
}

interface DeribitResponse<T> {
  jsonrpc: "2.0";
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
  usOut?: number;
}

export interface GldContractRequest {
  expiry: string;
  strike: number;
  optionType: "call" | "put";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": "GoldOptionsHedge/2.0",
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const current = cache.get(key) as CacheEntry<T> | undefined;
  if (current && current.expiresAt > Date.now()) return current.value;
  try {
    const value = await loader();
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    lastGood.set(key, value);
    return value;
  } catch (error) {
    const fallback = lastGood.get(key) as T | undefined;
    if (fallback !== undefined) {
      console.warn(`[MarketData] ${key} failed; returning the last good value:`, error);
      if (typeof fallback === "object" && fallback !== null && !Array.isArray(fallback) && "timestamp" in fallback) {
        return { ...fallback, stale: true, status: "stale" } as T;
      }
      return fallback;
    }
    throw error;
  }
}

export function clearMarketDataCache(): void {
  cache.clear();
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + sign * erf);
}

function bsPrice(spot: number, strike: number, years: number, rate: number, volatility: number, optionType: "call" | "put"): number {
  if (years <= 0) return Math.max(optionType === "call" ? spot - strike : strike - spot, 0);
  const sqrtTime = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + volatility * volatility / 2) * years) / (volatility * sqrtTime);
  const d2 = d1 - volatility * sqrtTime;
  return optionType === "call"
    ? spot * normalCdf(d1) - strike * Math.exp(-rate * years) * normalCdf(d2)
    : strike * Math.exp(-rate * years) * normalCdf(-d2) - spot * normalCdf(-d1);
}

/** Invert option price to annualized IV. Null means the quote violates no-arbitrage bounds or is unavailable. */
export function impliedVolatilityFromPrice(args: { price: number; spot: number; strike: number; expiry: string; optionType: "call" | "put"; asOf: number; expiryTimestamp?: number; rate?: number }): number | null {
  const { price, spot, strike, optionType, asOf } = args;
  if (![price, spot, strike].every(value => Number.isFinite(value) && value > 0)) return null;
  const expiryTime = args.expiryTimestamp ?? Date.parse(`${args.expiry}T20:00:00Z`);
  const years = Math.max((expiryTime - asOf) / (365.25 * 86_400_000), 1 / (365.25 * 24));
  const rate = Number.isFinite(args.rate) ? Number(args.rate) : 0.045;
  const discountedStrike = strike * Math.exp(-rate * years);
  const lowerBound = optionType === "call" ? Math.max(spot - discountedStrike, 0) : Math.max(discountedStrike - spot, 0);
  const upperBound = optionType === "call" ? spot : discountedStrike;
  if (price < lowerBound - 0.02 || price > upperBound + 0.02) return null;
  let low = 0.0001;
  let high = 5;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const mid = (low + high) / 2;
    if (bsPrice(spot, strike, years, rate, mid, optionType) < price) low = mid;
    else high = mid;
  }
  const result = (low + high) / 2;
  return Number.isFinite(result) ? result : null;
}

function timestampSeconds(value: unknown): number {
  const raw = toNumber(value);
  if (raw <= 0) return Date.now();
  return raw > 10_000_000_000 ? raw : raw * 1000;
}

function optionalTimestamp(value: unknown): number {
  const raw = toNumber(value);
  if (raw <= 0) return 0;
  return raw > 10_000_000_000 ? raw : raw * 1000;
}

export function parseCboeTimestamp(value: unknown): number {
  const text = String(value ?? "").trim();
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!matched) return optionalTimestamp(value);
  const [, year, month, day, hour, minute, second] = matched;
  // Cboe's delayed-quote JSON timestamps are UTC even though they omit the
  // trailing `Z`. Treating them as America/New_York makes quotes appear four
  // hours newer (and can silently turn stale data into apparent live data).
  return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
}

function spotPrice(price: number, timestamp: number, source: string, forceDelayed = false): SpotPrice {
  const delaySeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  const stale = delaySeconds > 60 * 60;
  return {
    price,
    timestamp,
    source,
    delaySeconds,
    status: stale ? "stale" : forceDelayed || delaySeconds > 5 * 60 ? "delayed" : "realtime",
    ...(stale ? { stale: true } : {}),
  };
}

async function getBybitOptionTickers(baseCoin: BybitOptionBaseCoin): Promise<BybitTickerOption[]> {
  return cached(`${baseCoin.toLowerCase()}-option-tickers`, LIVE_CACHE_MS, async () => {
    const data = await fetchJson<any>(`${BYBIT_BASE_URL}/v5/market/tickers?category=option&baseCoin=${baseCoin}`);
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
      throw new Error(data.retMsg || `Bybit returned no ${baseCoin} option tickers`);
    }
    const timestamp = timestampSeconds(data.time);
    return data.result.list.map((ticker: Record<string, unknown>) => ({ ...ticker, timestamp })) as BybitTickerOption[];
  }).catch(error => {
    console.error(`[MarketData] Failed to fetch ${baseCoin} option tickers:`, error);
    return [];
  });
}

async function getBybitOptionInstruments(baseCoin: BybitOptionBaseCoin): Promise<BybitInstrument[]> {
  return cached(`${baseCoin.toLowerCase()}-option-instruments`, 60_000, async () => {
    const instruments: BybitInstrument[] = [];
    let cursor = "";
    do {
      const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const data = await fetchJson<any>(`${BYBIT_BASE_URL}/v5/market/instruments-info?category=option&baseCoin=${baseCoin}&limit=1000${cursorQuery}`);
      if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
        throw new Error(data.retMsg || `Bybit returned no ${baseCoin} instruments`);
      }
      instruments.push(...data.result.list);
      cursor = String(data.result?.nextPageCursor || "");
    } while (cursor);
    return instruments;
  }).catch(error => {
    console.error(`[MarketData] Failed to fetch ${baseCoin} instruments:`, error);
    return [];
  });
}

export const getXautOptionTickers = () => getBybitOptionTickers("XAUT");
export const getBtcOptionTickers = () => getBybitOptionTickers("BTC");
export const getEthOptionTickers = () => getBybitOptionTickers("ETH");
export const getXautOptionInstruments = () => getBybitOptionInstruments("XAUT");
export const getBtcOptionInstruments = () => getBybitOptionInstruments("BTC");
export const getEthOptionInstruments = () => getBybitOptionInstruments("ETH");

function parseBybitOptionSymbol(symbol: string, baseCoin: BybitOptionBaseCoin): { expiry: string; strike: number; optionType: "call" | "put" } | null {
  const match = symbol.toUpperCase().match(new RegExp(`^${baseCoin}-(\\d{1,2})([A-Z]{3})(\\d{2})-([0-9.]+)-([CP])(?:-|$)`));
  if (!match || !MONTHS[match[2]]) return null;
  const [, day, month, year, strike, side] = match;
  return {
    expiry: `20${year}-${MONTHS[month]}-${day.padStart(2, "0")}`,
    strike: toNumber(strike),
    optionType: side === "C" ? "call" : "put",
  };
}

async function getBybitOptionChain(baseCoin: BybitOptionBaseCoin): Promise<XautOptionChain> {
  return cached(`bybit-${baseCoin.toLowerCase()}-full-chain`, 10_000, async () => {
    const [tickers, instruments, spotQuote] = await Promise.all([
      getBybitOptionTickers(baseCoin),
      getBybitOptionInstruments(baseCoin),
      getBybitSpotPrice(baseCoin),
    ]);
    const tickerMap = new Map(tickers.map(ticker => [ticker.symbol, ticker]));
    const timestamp = Math.max(...tickers.map(ticker => timestampSeconds(ticker.timestamp)), Date.now() - 60_000);
    const quotes: XautOptionQuote[] = [];
    for (const instrument of instruments.filter(item => item.status === "Trading")) {
        const parsed = parseBybitOptionSymbol(instrument.symbol, baseCoin);
        if (!parsed) continue;
        const ticker = tickerMap.get(instrument.symbol);
        const bidIv = ticker && toNumber(ticker.bid1Iv) > 0 ? toNumber(ticker.bid1Iv) : null;
        const askIv = ticker && toNumber(ticker.ask1Iv) > 0 ? toNumber(ticker.ask1Iv) : null;
        quotes.push({
          symbol: instrument.symbol,
          ...parsed,
          markPrice: ticker ? toNumber(ticker.markPrice) : 0,
          markIv: ticker ? toNumber(ticker.markIv) : 0,
          bidIv,
          askIv,
          ivSpread: bidIv !== null && askIv !== null ? askIv - bidIv : null,
          bid1Price: ticker ? toNumber(ticker.bid1Price) : 0,
          ask1Price: ticker ? toNumber(ticker.ask1Price) : 0,
          bid1Size: ticker && toNumber(ticker.bid1Size) > 0 ? toNumber(ticker.bid1Size) : null,
          ask1Size: ticker && toNumber(ticker.ask1Size) > 0 ? toNumber(ticker.ask1Size) : null,
          delta: ticker ? toNumber(ticker.delta) : 0,
          gamma: ticker ? toNumber(ticker.gamma) : 0,
          theta: ticker ? toNumber(ticker.theta) : 0,
          vega: ticker ? toNumber(ticker.vega) : 0,
          timestamp: ticker ? timestampSeconds(ticker.timestamp) : timestamp,
          source: "Bybit V5 realtime options" as const,
          openInterest: ticker ? toNumber(ticker.openInterest) : 0,
          volume: ticker ? toNumber(ticker.volume24h) : 0,
          tradeable: true,
          marketAvailable: Boolean(ticker),
        });
    }
    const delaySeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    return {
      quotes,
      spot: spotQuote?.price ?? toNumber(tickers[0]?.indexPrice),
      timestamp,
      source: `Bybit V5 realtime options · ${baseCoin}`,
      status: delaySeconds > 15 * 60 ? "stale" : "realtime",
      delaySeconds,
      contractCount: quotes.length,
      expiryCount: new Set(quotes.map(quote => quote.expiry)).size,
      strikeCount: new Set(quotes.map(quote => quote.strike)).size,
    };
  });
}

export const getXautOptionChain = () => getBybitOptionChain("XAUT");
export const getBtcOptionChain = () => getBybitOptionChain("BTC");
export const getEthOptionChain = () => getBybitOptionChain("ETH");

async function getBybitSpotPrice(baseCoin: BybitOptionBaseCoin): Promise<SpotPrice | null> {
  return cached(`${baseCoin.toLowerCase()}-spot`, LIVE_CACHE_MS, async () => {
    const data = await fetchJson<any>(`${BYBIT_BASE_URL}/v5/market/tickers?category=spot&symbol=${baseCoin}USDT`);
    const price = toNumber(data.result?.list?.[0]?.lastPrice);
    if (data.retCode !== 0 || price <= 0) throw new Error(data.retMsg || `Bybit returned no ${baseCoin} spot price`);
    return spotPrice(price, timestampSeconds(data.time), `Bybit V5 realtime · ${baseCoin}USDT`);
  }).catch(error => {
    console.error(`[MarketData] Failed to fetch ${baseCoin} spot:`, error);
    return null;
  });
}

export const getXautSpotPrice = () => getBybitSpotPrice("XAUT");
export const getBtcSpotPrice = () => getBybitSpotPrice("BTC");
export const getEthSpotPrice = () => getBybitSpotPrice("ETH");

function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function deribitModelGreeks(args: {
  spot: number;
  strike: number;
  expiryTimestamp: number;
  asOf: number;
  rate: number;
  volatility: number;
  optionType: "call" | "put";
}) {
  const years = Math.max((args.expiryTimestamp - args.asOf) / (365.25 * 86_400_000), 1 / (365.25 * 24));
  const sqrtTime = Math.sqrt(years);
  const d1 = (Math.log(args.spot / args.strike) + (args.rate + args.volatility * args.volatility / 2) * years) / (args.volatility * sqrtTime);
  const d2 = d1 - args.volatility * sqrtTime;
  const density = normalPdf(d1);
  const delta = args.optionType === "call" ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = density / (args.spot * args.volatility * sqrtTime);
  const thetaAnnual = args.optionType === "call"
    ? -(args.spot * density * args.volatility) / (2 * sqrtTime) - args.rate * args.strike * Math.exp(-args.rate * years) * normalCdf(d2)
    : -(args.spot * density * args.volatility) / (2 * sqrtTime) + args.rate * args.strike * Math.exp(-args.rate * years) * normalCdf(-d2);
  return {
    delta,
    gamma,
    theta: thetaAnnual / 365.25,
    vega: args.spot * density * sqrtTime / 100,
  };
}

/** Normalize a Deribit inverse option into the heatmap's decimal-IV schema. */
export function normalizeDeribitOption(
  instrument: DeribitInstrument,
  summary: DeribitBookSummary | undefined,
  asOf: number,
): XautOptionQuote {
  const expiry = new Date(instrument.expiration_timestamp).toISOString().slice(0, 10);
  const underlyingPrice = toNumber(summary?.underlying_price);
  const markIv = toNumber(summary?.mark_iv) / 100;
  const rate = toNumber(summary?.interest_rate);
  const bidPrice = toNumber(summary?.bid_price);
  const askPrice = toNumber(summary?.ask_price);
  // Deribit BTC/ETH inverse option premiums are quoted in the base coin.
  // Convert premium to USD before inverting Black-Scholes IV.
  const bidIv = bidPrice > 0 && underlyingPrice > 0
    ? impliedVolatilityFromPrice({
        price: bidPrice * underlyingPrice,
        spot: underlyingPrice,
        strike: instrument.strike,
        expiry,
        expiryTimestamp: instrument.expiration_timestamp,
        optionType: instrument.option_type,
        asOf,
        rate,
      })
    : null;
  const askIv = askPrice > 0 && underlyingPrice > 0
    ? impliedVolatilityFromPrice({
        price: askPrice * underlyingPrice,
        spot: underlyingPrice,
        strike: instrument.strike,
        expiry,
        expiryTimestamp: instrument.expiration_timestamp,
        optionType: instrument.option_type,
        asOf,
        rate,
      })
    : null;
  const model = underlyingPrice > 0 && markIv > 0
    ? deribitModelGreeks({
        spot: underlyingPrice,
        strike: instrument.strike,
        expiryTimestamp: instrument.expiration_timestamp,
        asOf,
        rate,
        volatility: markIv,
        optionType: instrument.option_type,
      })
    : null;
  const marketAvailable = Boolean(summary) && underlyingPrice > 0 && toNumber(summary?.mark_price) > 0 && markIv > 0;
  return {
    symbol: instrument.instrument_name,
    expiry,
    strike: instrument.strike,
    optionType: instrument.option_type,
    markPrice: toNumber(summary?.mark_price),
    markIv,
    bidIv,
    askIv,
    ivSpread: bidIv !== null && askIv !== null ? askIv - bidIv : null,
    bidIvDerived: bidIv !== null,
    askIvDerived: askIv !== null,
    expiryTimestamp: instrument.expiration_timestamp,
    bid1Price: bidPrice,
    ask1Price: askPrice,
    bid1Size: null,
    ask1Size: null,
    delta: model?.delta ?? 0,
    gamma: model?.gamma ?? 0,
    theta: model?.theta ?? 0,
    vega: model?.vega ?? 0,
    timestamp: optionalTimestamp(summary?.creation_timestamp) || asOf,
    source: `Deribit REST full-chain snapshot · model Greeks/Bid-Ask IV · premium ${instrument.quote_currency}`,
    openInterest: summary ? toNumber(summary.open_interest) : 0,
    volume: summary ? toNumber(summary.volume) : 0,
    tradeable: instrument.is_active && instrument.state === "open",
    marketAvailable,
    contractMultiplier: toNumber(instrument.contract_size) || 1,
    premiumCurrency: instrument.quote_currency,
  };
}

async function getDeribitOptionInstruments(currency: DeribitOptionCurrency): Promise<DeribitInstrument[]> {
  return cached(`deribit-${currency.toLowerCase()}-option-instruments`, 30 * 60_000, async () => {
    const response = await fetchJson<DeribitResponse<DeribitInstrument[]>>(
      `${DERIBIT_BASE_URL}/public/get_instruments?currency=${currency}&kind=option&expired=false`,
    );
    if (response.error || !Array.isArray(response.result)) {
      throw new Error(response.error?.message || `Deribit returned no ${currency} option instruments`);
    }
    return response.result;
  });
}

async function getDeribitBookSummaries(currency: DeribitOptionCurrency): Promise<{ summaries: DeribitBookSummary[]; timestamp: number }> {
  return cached(`deribit-${currency.toLowerCase()}-option-summary`, OPTION_CACHE_MS, async () => {
    const response = await fetchJson<DeribitResponse<DeribitBookSummary[]>>(
      `${DERIBIT_BASE_URL}/public/get_book_summary_by_currency?currency=${currency}&kind=option`,
    );
    if (response.error || !Array.isArray(response.result)) {
      throw new Error(response.error?.message || `Deribit returned no ${currency} option summaries`);
    }
    const serverTimestamp = toNumber(response.usOut) > 0 ? Math.round(toNumber(response.usOut) / 1000) : Date.now();
    const quoteTimestamp = Math.max(...response.result.map(summary => optionalTimestamp(summary.creation_timestamp)), serverTimestamp);
    return { summaries: response.result, timestamp: quoteTimestamp };
  });
}

async function getDeribitSpotPrice(currency: DeribitOptionCurrency): Promise<SpotPrice | null> {
  return cached(`deribit-${currency.toLowerCase()}-spot`, LIVE_CACHE_MS, async () => {
    const response = await fetchJson<DeribitResponse<{ index_price?: number }>>(
      `${DERIBIT_BASE_URL}/public/get_index_price?index_name=${currency.toLowerCase()}_usd`,
    );
    const price = toNumber(response.result?.index_price);
    if (response.error || price <= 0) throw new Error(response.error?.message || `Deribit returned no ${currency} index price`);
    const timestamp = toNumber(response.usOut) > 0 ? Math.round(toNumber(response.usOut) / 1000) : Date.now();
    return spotPrice(price, timestamp, `Deribit realtime index · ${currency}/USD`);
  }).catch(error => {
    console.error(`[MarketData] Failed to fetch Deribit ${currency} index:`, error);
    return null;
  });
}

async function getDeribitOptionChain(currency: DeribitOptionCurrency): Promise<XautOptionChain> {
  return cached(`deribit-${currency.toLowerCase()}-full-chain`, OPTION_CACHE_MS, async () => {
    const [instruments, summarySnapshot, spotQuote] = await Promise.all([
      getDeribitOptionInstruments(currency),
      getDeribitBookSummaries(currency),
      getDeribitSpotPrice(currency),
    ]);
    const summaryMap = new Map(summarySnapshot.summaries.map(summary => [summary.instrument_name, summary]));
    const activeInstruments = instruments.filter(instrument => instrument.kind === "option" && instrument.is_active && instrument.state === "open");
    const quotes = activeInstruments.map(instrument => normalizeDeribitOption(instrument, summaryMap.get(instrument.instrument_name), summarySnapshot.timestamp));
    const delaySeconds = Math.max(0, Math.round((Date.now() - summarySnapshot.timestamp) / 1000));
    return {
      quotes,
      spot: spotQuote?.price ?? toNumber(summarySnapshot.summaries.find(summary => toNumber(summary.underlying_price) > 0)?.underlying_price),
      timestamp: summarySnapshot.timestamp,
      source: `Deribit REST full-chain snapshot · ${currency}/USD inverse options`,
      status: delaySeconds > 15 * 60 ? "stale" : "realtime",
      delaySeconds,
      contractCount: quotes.length,
      expiryCount: new Set(quotes.map(quote => quote.expiry)).size,
      strikeCount: new Set(quotes.map(quote => quote.strike)).size,
    };
  });
}

export const getDeribitBtcOptionChain = () => getDeribitOptionChain("BTC");
export const getDeribitEthOptionChain = () => getDeribitOptionChain("ETH");
export const getDeribitBtcSpotPrice = () => getDeribitSpotPrice("BTC");
export const getDeribitEthSpotPrice = () => getDeribitSpotPrice("ETH");

async function getYahooPrice(symbol: string, cacheKey: string): Promise<SpotPrice | null> {
  return cached(cacheKey, 30_000, async () => {
    const data = await fetchJson<any>(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=1m&range=1d`);
    const result = data.chart?.result?.[0];
    const meta = result?.meta;
    const closes = result?.indicators?.quote?.[0]?.close as Array<number | null> | undefined;
    const latestClose = closes?.filter((value): value is number => typeof value === "number").at(-1);
    const price = toNumber(meta?.regularMarketPrice || latestClose);
    if (price <= 0) throw new Error(`Yahoo Finance returned no price for ${symbol}`);
    return spotPrice(
      price,
      timestampSeconds(meta?.regularMarketTime),
      "Yahoo Finance fallback",
      true,
    );
  }).catch(error => {
    console.error(`[MarketData] Failed to fetch ${symbol}:`, error);
    return null;
  });
}

async function getMarketDataGldPrice(): Promise<SpotPrice | null> {
  const token = process.env.MARKETDATA_TOKEN;
  if (!token) return null;
  return cached("marketdata-gld-spot", LIVE_CACHE_MS, async () => {
    const data = await fetchJson<any>(`${MARKETDATA_BASE_URL}/stocks/prices/GLD/?extended=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const price = toNumber(data.mid?.[0]);
    if (data.s !== "ok" || price <= 0) throw new Error(data.errmsg || "MarketData.app returned no GLD price");
    return spotPrice(price, timestampSeconds(data.updated?.[0]), "MarketData.app SmartMid realtime");
  }).catch(error => {
    console.error("[MarketData] Failed to fetch MarketData.app GLD spot:", error);
    return null;
  });
}

async function getTradierGldPrice(): Promise<SpotPrice | null> {
  const token = process.env.TRADIER_API_TOKEN;
  if (!token) return null;
  return cached("tradier-gld-spot", LIVE_CACHE_MS, async () => {
    const data = await fetchJson<any>(`${TRADIER_BASE_URL}/markets/quotes?symbols=GLD&greeks=false`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = Array.isArray(data.quotes?.quote) ? data.quotes.quote[0] : data.quotes?.quote;
    const bid = toNumber(raw?.bid);
    const ask = toNumber(raw?.ask);
    const last = toNumber(raw?.last);
    const price = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
    if (price <= 0) throw new Error("Tradier returned no GLD quote");
    const timestamp = Math.max(
      optionalTimestamp(raw?.trade_date),
      optionalTimestamp(raw?.bid_date),
      optionalTimestamp(raw?.ask_date),
    ) || Date.now();
    const sandbox = TRADIER_BASE_URL.includes("sandbox");
    return spotPrice(price, timestamp, sandbox ? "Tradier sandbox (15m delayed)" : "Tradier Brokerage realtime", sandbox);
  }).catch(error => {
    console.error("[MarketData] Failed to fetch Tradier GLD spot:", error);
    return null;
  });
}

async function getCboeGldPrice(): Promise<SpotPrice | null> {
  return cached("cboe-gld-spot", 15_000, async () => {
    const data = await fetchJson<any>(CBOE_GLD_QUOTE_URL);
    const bid = toNumber(data.data?.bid);
    const ask = toNumber(data.data?.ask);
    const price = bid > 0 && ask > 0 ? (bid + ask) / 2 : toNumber(data.data?.current_price);
    if (price <= 0) throw new Error("Cboe returned no GLD quote");
    const timestamp = parseCboeTimestamp(data.timestamp) || Date.now();
    return spotPrice(price, timestamp, "Cboe delayed quote / CTA", true);
  }).catch(error => {
    console.error("[MarketData] Failed to fetch Cboe GLD spot:", error);
    return null;
  });
}

export async function getGldPrice(): Promise<SpotPrice | null> {
  return await getMarketDataGldPrice()
    || await getTradierGldPrice()
    || await getCboeGldPrice()
    || await getYahooPrice("GLD", "gld-spot");
}

export async function getGoldPrice(): Promise<SpotPrice | null> {
  const yahoo = await getYahooPrice("GC=F", "gold-futures");
  if (yahoo) return yahoo;
  const xaut = await getXautSpotPrice();
  return xaut ? { ...xaut, source: "Bybit XAUT/USDT proxy", stale: true } : null;
}

export function buildOccOptionSymbol(contract: GldContractRequest): string {
  const [year, month, day] = contract.expiry.split("-");
  const strike = Math.round(contract.strike * 1000).toString().padStart(8, "0");
  const side = contract.optionType === "call" ? "C" : "P";
  return `GLD${year.slice(-2)}${month}${day}${side}${strike}`;
}

function first<T>(value: T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : undefined;
}

function normalizeMarketDataOption(data: any, contract: GldContractRequest): GldOptionQuote | null {
  if (data?.s !== "ok") return null;
  const bid = toNumber(first(data.bid));
  const ask = toNumber(first(data.ask));
  const mid = toNumber(first(data.mid));
  const last = toNumber(first(data.last));
  const markPrice = mid > 0 ? mid : bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
  if (markPrice <= 0) return null;
  return {
    symbol: String(first(data.optionSymbol) || buildOccOptionSymbol(contract)),
    expiry: contract.expiry,
    strike: contract.strike,
    optionType: contract.optionType,
    markPrice,
    markIv: toNumber(first(data.iv)),
    bidIv: null,
    askIv: null,
    ivSpread: null,
    bid1Price: bid,
    ask1Price: ask,
    bid1Size: toNumber(first(data.bidSize)) > 0 ? toNumber(first(data.bidSize)) : null,
    ask1Size: toNumber(first(data.askSize)) > 0 ? toNumber(first(data.askSize)) : null,
    delta: toNumber(first(data.delta)),
    gamma: toNumber(first(data.gamma)),
    theta: toNumber(first(data.theta)),
    vega: toNumber(first(data.vega)),
    timestamp: timestampSeconds(first(data.updated)),
    source: "MarketData.app / OPRA",
  };
}

async function getMarketDataGldOptionQuotes(contracts: GldContractRequest[]): Promise<GldOptionQuote[]> {
  const token = process.env.MARKETDATA_TOKEN;
  if (!token || contracts.length === 0) return [];
  const unique = [...new Map(contracts.map(contract => [buildOccOptionSymbol(contract), contract])).entries()].slice(0, 100);
  const quotes = await Promise.all(unique.map(async ([symbol, contract]) =>
    cached(`marketdata-gld-${symbol}`, OPTION_CACHE_MS, async () => {
      const data = await fetchJson<any>(`${MARKETDATA_BASE_URL}/options/quotes/${symbol}/?mode=live`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const quote = normalizeMarketDataOption(data, contract);
      if (!quote) throw new Error(data?.errmsg || `MarketData.app returned no quote for ${symbol}`);
      return quote;
    }).catch(error => {
      console.error(`[MarketData] Failed to fetch MarketData.app option ${symbol}:`, error);
      return null;
    }),
  ));
  return quotes.filter((quote): quote is GldOptionQuote => quote !== null);
}

function normalizeTradierOption(raw: any, expiry: string): GldOptionQuote | null {
  const optionType = String(raw.option_type || "").toLowerCase();
  if (optionType !== "call" && optionType !== "put") return null;
  const bid = toNumber(raw.bid);
  const ask = toNumber(raw.ask);
  const last = toNumber(raw.last);
  const markPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
  const greeks = raw.greeks || {};
  const rawIv = toNumber(greeks.mid_iv || greeks.smv_vol || raw.iv);
  const normalizeIv = (value: unknown) => {
    const iv = toNumber(value);
    return iv > 0 ? (iv > 3 ? iv / 100 : iv) : null;
  };
  const bidIv = normalizeIv(greeks.bid_iv || raw.bid_iv);
  const askIv = normalizeIv(greeks.ask_iv || raw.ask_iv);
  return {
    symbol: String(raw.symbol || ""),
    expiry: String(raw.expiration_date || expiry),
    strike: toNumber(raw.strike),
    optionType,
    markPrice,
    markIv: rawIv > 3 ? rawIv / 100 : rawIv,
    bidIv,
    askIv,
    ivSpread: bidIv !== null && askIv !== null ? askIv - bidIv : null,
    bid1Price: bid,
    ask1Price: ask,
    bid1Size: toNumber(raw.bidsize ?? raw.bid_size) > 0 ? toNumber(raw.bidsize ?? raw.bid_size) : null,
    ask1Size: toNumber(raw.asksize ?? raw.ask_size) > 0 ? toNumber(raw.asksize ?? raw.ask_size) : null,
    delta: toNumber(greeks.delta),
    gamma: toNumber(greeks.gamma),
    theta: toNumber(greeks.theta),
    vega: toNumber(greeks.vega),
    timestamp: Math.max(
      optionalTimestamp(raw.trade_date),
      optionalTimestamp(raw.bid_date),
      optionalTimestamp(raw.ask_date),
      optionalTimestamp(greeks.updated_at),
    ) || Date.now(),
    source: "Tradier / ORATS",
  };
}

export function normalizeCboeGldOption(raw: any, timestamp: number, spot = 0): GldOptionQuote | null {
  const symbol = String(raw?.option ?? "").trim().toUpperCase();
  const match = symbol.match(/^GLD(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;
  const [, year, month, day, side, strikeToken] = match;
  const bid = toNumber(raw.bid);
  const ask = toNumber(raw.ask);
  const theoretical = toNumber(raw.theo);
  const last = toNumber(raw.last_trade_price);
  const markPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : theoretical > 0 ? theoretical : last > 0 ? last : 0;
  const expiry = `20${year}-${month}-${day}`;
  const strike = Number(strikeToken) / 1000;
  const optionType = side === "C" ? "call" : "put";
  const bidIv = impliedVolatilityFromPrice({ price: bid, spot, strike, expiry, optionType, asOf: timestamp });
  const askIv = impliedVolatilityFromPrice({ price: ask, spot, strike, expiry, optionType, asOf: timestamp });
  return {
    symbol,
    expiry,
    strike,
    optionType,
    markPrice,
    markIv: toNumber(raw.iv),
    bidIv,
    askIv,
    ivSpread: bidIv !== null && askIv !== null ? askIv - bidIv : null,
    bidIvDerived: bidIv !== null,
    askIvDerived: askIv !== null,
    bid1Price: bid,
    ask1Price: ask,
    bid1Size: toNumber(raw.bid_size ?? raw.bidsize) > 0 ? toNumber(raw.bid_size ?? raw.bidsize) : null,
    ask1Size: toNumber(raw.ask_size ?? raw.asksize) > 0 ? toNumber(raw.ask_size ?? raw.asksize) : null,
    delta: toNumber(raw.delta),
    gamma: toNumber(raw.gamma),
    theta: toNumber(raw.theta),
    vega: toNumber(raw.vega),
    timestamp,
    source: "Cboe delayed options / OPRA",
    openInterest: toNumber(raw.open_interest),
    volume: toNumber(raw.volume),
    tradeable: true,
  };
}

export async function getGldOptionChain(): Promise<GldOptionChain> {
  return cached("cboe-gld-full-chain", 30_000, async () => {
    const [data, canonicalSpot] = await Promise.all([
      fetchJson<any>(CBOE_GLD_CHAIN_URL),
      getGldPrice().catch(() => null),
    ]);
    const timestamp = parseCboeTimestamp(data.timestamp) || Date.now();
    const spot = canonicalSpot?.price ?? toNumber(data.data?.current_price);
    const quotes = (Array.isArray(data.data?.options) ? data.data.options : [])
      .map((raw: any) => normalizeCboeGldOption(raw, timestamp, spot))
      .filter((quote: GldOptionQuote | null): quote is GldOptionQuote => quote !== null);
    if (!quotes.length) throw new Error("Cboe returned no GLD option contracts");
    const delaySeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    return {
      quotes,
      spot,
      timestamp,
      source: "Cboe delayed options / OPRA",
      status: delaySeconds > 60 * 60 ? "stale" : "delayed",
      delaySeconds,
      contractCount: quotes.length,
      expiryCount: new Set(quotes.map((quote: GldOptionQuote) => quote.expiry)).size,
      strikeCount: new Set(quotes.map((quote: GldOptionQuote) => quote.strike)).size,
    };
  });
}

export async function getGldOptionQuotes(
  expiries: string[],
  contracts: GldContractRequest[] = [],
): Promise<GldOptionQuote[]> {
  const marketDataQuotes = await getMarketDataGldOptionQuotes(contracts);
  const token = process.env.TRADIER_API_TOKEN;
  if (!token || expiries.length === 0) {
    const chain = await getGldOptionChain().catch(error => {
      console.error("[MarketData] Failed to fetch Cboe GLD option chain:", error);
      return null;
    });
    if (!chain) return marketDataQuotes;
    const wanted = new Set(contracts.map(contract => `${contract.expiry}|${contract.strike}|${contract.optionType}`));
    const fallback = chain.quotes.filter(quote => wanted.has(`${quote.expiry}|${quote.strike}|${quote.optionType}`));
    const priorityKeys = new Set(marketDataQuotes.map(quote => `${quote.expiry}|${quote.strike}|${quote.optionType}`));
    return [...marketDataQuotes, ...fallback.filter(quote => !priorityKeys.has(`${quote.expiry}|${quote.strike}|${quote.optionType}`))];
  }
  const uniqueExpiries = [...new Set(expiries)].slice(0, 24);
  const chains = await Promise.all(uniqueExpiries.map(expiry =>
    cached(`tradier-gld-${expiry}`, OPTION_CACHE_MS, async () => {
      const url = `${TRADIER_BASE_URL}/markets/options/chains?symbol=GLD&expiration=${encodeURIComponent(expiry)}&greeks=true`;
      const data = await fetchJson<any>(url, { headers: { Authorization: `Bearer ${token}` } });
      const rawOptions = data.options?.option;
      const list = Array.isArray(rawOptions) ? rawOptions : rawOptions ? [rawOptions] : [];
      return list.map((raw: any) => normalizeTradierOption(raw, expiry)).filter(Boolean) as GldOptionQuote[];
    }).catch(error => {
      console.error(`[MarketData] Failed to fetch Tradier GLD chain ${expiry}:`, error);
      return [];
    }),
  ));
  const priorityKeys = new Set(marketDataQuotes.map(quote => `${quote.expiry}|${quote.strike}|${quote.optionType}`));
  const tradierQuotes = [
    ...marketDataQuotes,
    ...chains.flat().filter(quote => !priorityKeys.has(`${quote.expiry}|${quote.strike}|${quote.optionType}`)),
  ];
  const foundKeys = new Set(tradierQuotes.map(quote => `${quote.expiry}|${quote.strike}|${quote.optionType}`));
  const missing = contracts.filter(contract => !foundKeys.has(`${contract.expiry}|${contract.strike}|${contract.optionType}`));
  if (!missing.length) return tradierQuotes;
  const chain = await getGldOptionChain().catch(() => null);
  const wanted = new Set(missing.map(contract => `${contract.expiry}|${contract.strike}|${contract.optionType}`));
  return [...tradierQuotes, ...(chain?.quotes ?? []).filter(quote => wanted.has(`${quote.expiry}|${quote.strike}|${quote.optionType}`))];
}

export function getMarketSources() {
  return {
    marketDataConfigured: Boolean(process.env.MARKETDATA_TOKEN),
    tradierConfigured: Boolean(process.env.TRADIER_API_TOKEN),
    gldPriority: process.env.MARKETDATA_TOKEN
      ? "MarketData.app OPRA 实时期权 / SmartMid 实时现价"
      : process.env.TRADIER_API_TOKEN
        ? "Tradier 实时报价；ORATS Greeks 约每小时更新"
        : "Yahoo Finance 兼容接口；可能延迟，Greeks 使用模型估算",
    sources: [
      {
        product: "XAUT 期权 / Greeks / Bid-Ask",
        provider: "Bybit V5 REST",
        endpoint: "/v5/market/tickers?category=option&baseCoin=XAUT",
        authentication: "无需密钥",
        mode: "交易所实时快照",
        documentationUrl: "https://bybit-exchange.github.io/docs/v5/market/tickers",
      },
      {
        product: "XAUT/USDT Spot",
        provider: "Bybit V5 REST",
        endpoint: "/v5/market/tickers?category=spot&symbol=XAUTUSDT",
        authentication: "无需密钥",
        mode: "交易所实时快照",
        documentationUrl: "https://bybit-exchange.github.io/docs/v5/market/tickers",
      },
      {
        product: "BTC 期权 / Greeks / Bid-Ask / Top-of-book Size",
        provider: "Bybit V5 REST",
        endpoint: "/v5/market/tickers?category=option&baseCoin=BTC",
        authentication: "无需密钥",
        mode: "交易所实时完整期权链快照；包含 Bid/Ask 一档价格、数量、IV 与 Greeks",
        documentationUrl: "https://bybit-exchange.github.io/docs/v5/market/tickers",
      },
      {
        product: "BTC/USDT Spot",
        provider: "Bybit V5 REST",
        endpoint: "/v5/market/tickers?category=spot&symbol=BTCUSDT",
        authentication: "无需密钥",
        mode: "交易所实时快照",
        documentationUrl: "https://bybit-exchange.github.io/docs/v5/market/tickers",
      },
      {
        product: "ETH 期权 / Greeks / Bid-Ask / Top-of-book Size",
        provider: "Bybit V5 REST",
        endpoint: "/v5/market/tickers?category=option&baseCoin=ETH",
        authentication: "无需密钥",
        mode: "交易所实时完整期权链快照；包含 Bid/Ask 一档价格、数量、IV 与 Greeks",
        documentationUrl: "https://bybit-exchange.github.io/docs/v5/market/tickers",
      },
      {
        product: "ETH/USDT Spot",
        provider: "Bybit V5 REST",
        endpoint: "/v5/market/tickers?category=spot&symbol=ETHUSDT",
        authentication: "无需密钥",
        mode: "交易所实时快照",
        documentationUrl: "https://bybit-exchange.github.io/docs/v5/market/tickers",
      },
      {
        product: "BTC + ETH 完整期权链 / Mark IV / Bid-Ask / OI / Volume",
        provider: "Deribit Public REST",
        endpoint: "/api/v2/public/get_instruments + /public/get_book_summary_by_currency",
        authentication: "无需密钥",
        mode: "交易所实时全链快照；币本位权利金保留原生单位，Greeks 与 Bid/Ask IV 由统一 Black-Scholes 模型补全",
        documentationUrl: "https://docs.deribit.com/articles/options-data-collection-best-practices",
      },
      {
        product: "BTC/USD + ETH/USD Index",
        provider: "Deribit Public REST",
        endpoint: "/api/v2/public/get_index_price",
        authentication: "无需密钥",
        mode: "交易所实时指数快照，用于 ATM 与 Spot 定位",
        documentationUrl: "https://docs.deribit.com/api-reference/market-data/public-get_index_price",
      },
      {
        product: "GLD 完整期权链 / Greeks / Bid-Ask（免密钥底座）",
        provider: "Cboe Delayed Quotes / OPRA",
        endpoint: "/api/global/delayed_quotes/options/GLD.json",
        authentication: "无需密钥",
        mode: "完整上市合约；延迟行情，页面显示 Source / As-of / STALE",
        documentationUrl: "https://www.cboe.com/delayed_quotes/gld/quote_table",
      },
      {
        product: "GLD 实时期权 / Greeks / Bid-Ask（首选）",
        provider: "MarketData.app / OPRA",
        endpoint: "/v1/options/quotes/{OCC_SYMBOL}/?mode=live",
        authentication: "MARKETDATA_TOKEN + OPRA 实时权限",
        mode: process.env.MARKETDATA_TOKEN ? "已配置；逐仓位低延迟查询" : "未配置",
        documentationUrl: "https://www.marketdata.app/docs/api/options/quotes/",
      },
      {
        product: "GLD 实时 Spot（首选）",
        provider: "MarketData.app SmartMid / Tradier Brokerage",
        endpoint: "/v1/stocks/prices/GLD/ → /v1/markets/quotes?symbols=GLD",
        authentication: "MARKETDATA_TOKEN 或 TRADIER_API_TOKEN",
        mode: process.env.MARKETDATA_TOKEN || process.env.TRADIER_API_TOKEN ? "已配置实时源" : "未配置，转 Yahoo fallback",
        documentationUrl: "https://www.marketdata.app/docs/api/stocks/prices/",
      },
      {
        product: "GLD 期权链兼容源",
        provider: "Tradier Brokerage API / ORATS",
        endpoint: "/v1/markets/options/chains?greeks=true",
        authentication: "TRADIER_API_TOKEN（必须使用 production token）",
        mode: process.env.TRADIER_API_TOKEN ? "已配置；报价实时、Greeks 约每小时" : "未配置",
        documentationUrl: "https://docs.tradier.com/docs/market-data",
      },
      {
        product: "GLD / GC=F 最后备用源",
        provider: "Yahoo Finance chart compatibility endpoint",
        endpoint: "/v8/finance/chart/{symbol}",
        authentication: "无需密钥；非官方兼容接口",
        mode: "仅 fallback；页面明确显示时间戳和延迟状态",
        documentationUrl: "https://finance.yahoo.com/quote/GLD/",
      },
    ],
  };
}
