import type { SpotPrice } from "@shared/marketTypes";

const BYBIT_BASE_URL = "https://api.bybit.com";
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
  ask1Price: string;
  ask1Size: string;
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
  bid1Price: number;
  ask1Price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  timestamp: number;
  source: "MarketData.app / OPRA" | "Tradier / ORATS" | "Cboe delayed options / OPRA";
  openInterest?: number;
  volume?: number;
  tradeable?: boolean;
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

function exchangeTimestamp(value: unknown): number {
  const text = String(value ?? "").trim();
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!matched) return optionalTimestamp(value);
  const [, year, month, day, hour, minute, second] = matched;
  const naiveUtc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(naiveUtc));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value);
  const displayedAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return naiveUtc - (displayedAsUtc - naiveUtc);
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

export async function getXautOptionTickers(): Promise<BybitTickerOption[]> {
  return cached("xaut-option-tickers", LIVE_CACHE_MS, async () => {
    const data = await fetchJson<any>(`${BYBIT_BASE_URL}/v5/market/tickers?category=option&baseCoin=XAUT`);
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
      throw new Error(data.retMsg || "Bybit returned no XAUT option tickers");
    }
    const timestamp = timestampSeconds(data.time);
    return data.result.list.map((ticker: Record<string, unknown>) => ({ ...ticker, timestamp })) as BybitTickerOption[];
  }).catch(error => {
    console.error("[MarketData] Failed to fetch XAUT option tickers:", error);
    return [];
  });
}

export async function getXautOptionInstruments(): Promise<BybitInstrument[]> {
  return cached("xaut-option-instruments", 60_000, async () => {
    const data = await fetchJson<any>(`${BYBIT_BASE_URL}/v5/market/instruments-info?category=option&baseCoin=XAUT&limit=1000`);
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
      throw new Error(data.retMsg || "Bybit returned no XAUT instruments");
    }
    return data.result.list;
  }).catch(error => {
    console.error("[MarketData] Failed to fetch XAUT instruments:", error);
    return [];
  });
}

export async function getXautSpotPrice(): Promise<SpotPrice | null> {
  return cached("xaut-spot", LIVE_CACHE_MS, async () => {
    const data = await fetchJson<any>(`${BYBIT_BASE_URL}/v5/market/tickers?category=spot&symbol=XAUTUSDT`);
    const price = toNumber(data.result?.list?.[0]?.lastPrice);
    if (data.retCode !== 0 || price <= 0) throw new Error(data.retMsg || "Bybit returned no XAUT spot price");
    return spotPrice(price, timestampSeconds(data.time), "Bybit V5 realtime");
  }).catch(error => {
    console.error("[MarketData] Failed to fetch XAUT spot:", error);
    return null;
  });
}

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
    const timestamp = exchangeTimestamp(data.timestamp) || Date.now();
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
    bid1Price: bid,
    ask1Price: ask,
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
  return {
    symbol: String(raw.symbol || ""),
    expiry: String(raw.expiration_date || expiry),
    strike: toNumber(raw.strike),
    optionType,
    markPrice,
    markIv: rawIv > 3 ? rawIv / 100 : rawIv,
    bid1Price: bid,
    ask1Price: ask,
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

export function normalizeCboeGldOption(raw: any, timestamp: number): GldOptionQuote | null {
  const symbol = String(raw?.option ?? "").trim().toUpperCase();
  const match = symbol.match(/^GLD(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;
  const [, year, month, day, side, strikeToken] = match;
  const bid = toNumber(raw.bid);
  const ask = toNumber(raw.ask);
  const theoretical = toNumber(raw.theo);
  const last = toNumber(raw.last_trade_price);
  const markPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : theoretical > 0 ? theoretical : last > 0 ? last : 0;
  return {
    symbol,
    expiry: `20${year}-${month}-${day}`,
    strike: Number(strikeToken) / 1000,
    optionType: side === "C" ? "call" : "put",
    markPrice,
    markIv: toNumber(raw.iv),
    bid1Price: bid,
    ask1Price: ask,
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
    const data = await fetchJson<any>(CBOE_GLD_CHAIN_URL);
    const timestamp = exchangeTimestamp(data.timestamp) || Date.now();
    const quotes = (Array.isArray(data.data?.options) ? data.data.options : [])
      .map((raw: any) => normalizeCboeGldOption(raw, timestamp))
      .filter((quote: GldOptionQuote | null): quote is GldOptionQuote => quote !== null);
    if (!quotes.length) throw new Error("Cboe returned no GLD option contracts");
    const delaySeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    return {
      quotes,
      spot: toNumber(data.data?.current_price),
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
