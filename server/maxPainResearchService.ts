import {
  MAX_INTRADAY_QUERY_DAYS,
  OBSERVATION_HOURS,
  SIGNALPLUS_EARLIEST_VERIFIED_DATE,
  calculateIntradayPoint,
  type GammaStrikeBook,
  type MarketHistoryResponse,
  type ObservationHour,
  type OptionProduct,
  type ResearchKline,
  type ResearchKlineInterval,
  type SignalPlusDayResponse,
  type SignalPlusStrikeSnapshotResponse,
} from "@shared/maxPainResearch";

const SIGNALPLUS_PRIMARY = "https://mizar-gateway.signalplus.com";
const SIGNALPLUS_MIRROR = "https://mizar-gateway.signalplus.net";
const SIGNALPLUS_PATH = "/mizar/data/bus/open-interest-history";
const COINBASE_EXCHANGE_API = "https://api.exchange.coinbase.com";
const OKX_MARKET_API = "https://www.okx.com/api/v5";
const BINANCE_MARKET_API = "https://data-api.binance.vision/api/v3";
const SNAPSHOT_LOOKBACK_MS = 30 * 60 * 1000;
const DAY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface RawOiRow {
  instrument_name?: string;
  type?: string;
  open_interest?: number;
  ts?: number;
}

interface SignalPlusPayload {
  succ?: boolean;
  message?: string;
  value?: RawOiRow[];
}

interface ParsedOption {
  instrument: string;
  maturity: string;
  strike: number;
  side: "call" | "put";
  product: OptionProduct;
  openInterest: number;
  timestamp: number;
}

const dayCache = new Map<
  string,
  { expiresAt: number; value: SignalPlusDayResponse }
>();
const strikeSnapshotCache = new Map<
  string,
  { expiresAt: number; value: SignalPlusStrikeSnapshotResponse }
>();
const marketCache = new Map<
  string,
  { expiresAt: number; value: MarketHistoryResponse }
>();

function fetchWithTimeout(url: string, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    signal: controller.signal,
    headers: {
      accept: "application/json",
      "user-agent": "CronusOptionsResearch/2.0",
    },
  }).finally(() => clearTimeout(timer));
}

function assertIsoDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new Error(`无效 UTC 日期：${value}`);
  }
}

function parseMaturity(value: string) {
  const match = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(value);
  if (!match) return null;
  const month = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ].indexOf(match[2]);
  if (month < 0) return null;
  const date = new Date(
    Date.UTC(2000 + Number(match[3]), month, Number(match[1]))
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Parse the two Deribit-style product prefixes returned by SignalPlus.
 * BTC-* maps to Deribit Inverse Options (API instrument_type=reversed), while
 * BTC_USDC-* maps to Linear USDC Options (instrument_type=linear).
 */
export function parseSignalPlusOption(row: RawOiRow): ParsedOption | null {
  if (
    row.type !== "OPTION" ||
    !row.instrument_name ||
    !Number.isFinite(row.open_interest) ||
    !Number.isFinite(row.ts)
  )
    return null;
  const match =
    /^(BTC|BTC_USDC)-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(
      row.instrument_name
    );
  if (!match) return null;
  const maturity = parseMaturity(match[2]);
  const strike = Number(match[3]);
  if (
    !maturity ||
    !Number.isFinite(strike) ||
    strike <= 0 ||
    Number(row.open_interest) < 0
  )
    return null;
  return {
    instrument: row.instrument_name,
    maturity,
    strike,
    side: match[4] === "C" ? "call" : "put",
    product: match[1] === "BTC" ? "inverse" : "linear",
    openInterest: Number(row.open_interest),
    timestamp: Number(row.ts),
  };
}

async function requestSnapshot(host: string, timestamp: number) {
  const params = new URLSearchParams({
    startTime: String(timestamp - SNAPSHOT_LOOKBACK_MS),
    endTime: String(timestamp),
  });
  const response = await fetchWithTimeout(
    `${host}${SIGNALPLUS_PATH}?${params}`
  );
  if (!response.ok) throw new Error(`SignalPlus ${response.status}`);
  const payload = (await response.json()) as SignalPlusPayload;
  if (payload.succ === false || !Array.isArray(payload.value)) {
    throw new Error(payload.message || "SignalPlus 返回格式异常");
  }

  // Keep the last row at or before the observation time for every instrument.
  // This prevents look-ahead when the endpoint returns several time-series rows.
  const latest = new Map<string, ParsedOption>();
  for (const raw of payload.value) {
    const parsed = parseSignalPlusOption(raw);
    if (!parsed || parsed.timestamp > timestamp) continue;
    const previous = latest.get(parsed.instrument);
    if (!previous || previous.timestamp < parsed.timestamp)
      latest.set(parsed.instrument, parsed);
  }
  return [...latest.values()];
}

export function buildStrikeBooks(options: ParsedOption[]): GammaStrikeBook[] {
  const base = new Map<
    string,
    Map<number, { strike: number; callOi: number; putOi: number }>
  >();
  for (const option of options) {
    const key = `${option.product}|${option.maturity}`;
    const strikes = base.get(key) ?? new Map();
    const row = strikes.get(option.strike) ?? {
      strike: option.strike,
      callOi: 0,
      putOi: 0,
    };
    if (option.side === "call") row.callOi += option.openInterest;
    else row.putOi += option.openInterest;
    strikes.set(option.strike, row);
    base.set(key, strikes);
  }

  const books: GammaStrikeBook[] = [];
  for (const [key, strikeMap] of base) {
    const [product, maturity] = key.split("|") as [OptionProduct, string];
    books.push({
      maturity,
      product,
      strikes: [...strikeMap.values()].sort((a, b) => a.strike - b.strike),
    });
  }

  return books;
}

async function fetchObservation(timestamp: number) {
  try {
    return {
      options: await requestSnapshot(SIGNALPLUS_PRIMARY, timestamp),
      host: SIGNALPLUS_PRIMARY,
    };
  } catch (primaryError) {
    try {
      return {
        options: await requestSnapshot(SIGNALPLUS_MIRROR, timestamp),
        host: SIGNALPLUS_MIRROR,
      };
    } catch {
      throw primaryError;
    }
  }
}

/**
 * Load one historical observation on demand. Keeping these larger strike books
 * out of the multi-day response prevents a 90-day page from downloading all
 * six raw OI surfaces before the user chooses a snapshot.
 */
export async function fetchSignalPlusStrikeSnapshot(
  date: string,
  hourUtc: ObservationHour
): Promise<SignalPlusStrikeSnapshotResponse> {
  assertIsoDate(date);
  if (!OBSERVATION_HOURS.includes(hourUtc))
    throw new Error(`不支持的 UTC 观察时点：${hourUtc}`);
  if (date < SIGNALPLUS_EARLIEST_VERIFIED_DATE) {
    throw new Error(
      `SignalPlus 生产端点已验证的最早可用日期为 ${SIGNALPLUS_EARLIEST_VERIFIED_DATE}`
    );
  }
  const timestamp = Date.parse(
    `${date}T${String(hourUtc).padStart(2, "0")}:00:00Z`
  );
  if (timestamp > Date.now()) throw new Error("所选 UTC 观察时点尚未发生");
  const key = `${date}|${hourUtc}`;
  const cached = strikeSnapshotCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const observation = await fetchObservation(timestamp);
  if (!observation.options.length)
    throw new Error("该时点前 30 分钟内没有可用的 BTC 期权 OI 记录");
  const books = buildStrikeBooks(observation.options);
  const sourceTimestamp = Math.max(
    ...observation.options.map(option => option.timestamp)
  );
  const points = books.flatMap(book => {
    const point = calculateIntradayPoint(
      timestamp,
      book.maturity,
      book.product,
      book.strikes,
      sourceTimestamp
    );
    return point ? [point] : [];
  });
  const value: SignalPlusStrikeSnapshotResponse = {
    date,
    hourUtc,
    timestamp,
    provider: "SignalPlus",
    providerHost: observation.host,
    sourceTimestamp,
    books,
    points,
    warnings: [
      "逐 Strike OI 为观察时点前 30 分钟内每份合约的最后记录，不包含未来数据。",
      "接口没有 exchange 字段；Deribit 风格合约名不能单独证明交易所归属。",
      "BTC-* 与 BTC_USDC-* 按产品分别计算；SignalPlus 不返回结算币种或合约乘数，因此不做跨产品 OI 或 Max Pain 汇总。",
    ],
  };
  strikeSnapshotCache.set(key, {
    expiresAt: Date.now() + DAY_CACHE_TTL_MS,
    value,
  });
  return value;
}

/** Fetch all six UTC observations for a day and calculate every expiry/product. */
export async function fetchSignalPlusDay(
  date: string
): Promise<SignalPlusDayResponse> {
  assertIsoDate(date);
  if (date < SIGNALPLUS_EARLIEST_VERIFIED_DATE) {
    throw new Error(
      `SignalPlus 生产端点已验证的最早可用日期为 ${SIGNALPLUS_EARLIEST_VERIFIED_DATE}`
    );
  }
  const cached = dayCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const results = await Promise.all(
    OBSERVATION_HOURS.map(async hour => {
      const timestamp = Date.parse(
        `${date}T${String(hour).padStart(2, "0")}:00:00Z`
      );
      if (timestamp > Date.now())
        return { hour, snapshot: undefined, error: "观察时点尚未发生" };
      try {
        return {
          hour,
          snapshot: await fetchSignalPlusStrikeSnapshot(date, hour),
          error: undefined,
        };
      } catch (error) {
        return {
          hour,
          snapshot: undefined,
          error: error instanceof Error ? error.message : "读取失败",
        };
      }
    })
  );

  const points = [];
  let gammaBooksAtZero: GammaStrikeBook[] = [];
  const missingHours: ObservationHour[] = [];
  const hosts = new Set<string>();
  const observationWarnings: string[] = [];
  for (const result of results) {
    if (!result.snapshot) {
      missingHours.push(result.hour);
      if (result.error !== "观察时点尚未发生")
        observationWarnings.push(
          `${String(result.hour).padStart(2, "0")}:00 ${result.error}`
        );
      continue;
    }
    hosts.add(result.snapshot.providerHost);
    const books = result.snapshot.books;
    if (result.hour === 0) gammaBooksAtZero = books;
    points.push(...result.snapshot.points);
  }
  if (!points.length && observationWarnings.length)
    throw new Error(`六个观察时点均不可用：${observationWarnings.join("；")}`);
  const value: SignalPlusDayResponse = {
    date,
    provider: "SignalPlus",
    providerHost:
      hosts.size === 1
        ? [...hosts][0]
        : hosts.size
          ? [...hosts].join(", ")
          : SIGNALPLUS_PRIMARY,
    points,
    gammaBooksAtZero,
    missingHours,
    warnings: [
      "SignalPlus 没有公开历史保留 SLA；2023-05-05 是项目实测边界，不是供应商承诺。",
      "每个观察时点使用该时点前 30 分钟内每份合约的最后记录，不包含未来数据。",
      ...observationWarnings,
    ],
  };
  dayCache.set(date, { expiresAt: Date.now() + DAY_CACHE_TTL_MS, value });
  return value;
}

function intervalMilliseconds(interval: ResearchKlineInterval) {
  return {
    "1h": 3_600_000,
    "4h": 4 * 3_600_000,
    "12h": 12 * 3_600_000,
    "1d": 86_400_000,
  }[interval];
}

function validateHourlyKlines(rows: ResearchKline[], provider: string) {
  const valid = rows
    .filter(
      row =>
        Number.isFinite(row.openTime) &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close) &&
        row.open > 0 &&
        row.high >= row.low
    )
    .sort((a, b) => a.openTime - b.openTime);
  const unique = [...new Map(valid.map(row => [row.openTime, row])).values()];
  if (unique.length < 24)
    throw new Error(`${provider} 返回的有效小时 K 线不足`);
  return unique;
}

/** Coinbase public Exchange candles, fetched in <=300-candle chunks. */
async function fetchCoinbaseHourly(startTime: number, endTime: number) {
  const hour = 3_600_000;
  const result: ResearchKline[] = [];
  let cursor = startTime;
  while (cursor <= endTime) {
    const chunkEnd = Math.min(cursor + 299 * hour, endTime);
    const params = new URLSearchParams({
      granularity: "3600",
      start: new Date(cursor).toISOString(),
      end: new Date(chunkEnd).toISOString(),
    });
    const response = await fetchWithTimeout(
      `${COINBASE_EXCHANGE_API}/products/BTC-USD/candles?${params}`
    );
    if (!response.ok) throw new Error(`Coinbase Kline ${response.status}`);
    const rows = (await response.json()) as unknown[][];
    if (!Array.isArray(rows)) throw new Error("Coinbase Kline 返回格式异常");
    for (const row of rows) {
      const openTime = Number(row[0]) * 1000;
      result.push({
        openTime,
        closeTime: openTime + hour - 1,
        low: Number(row[1]),
        high: Number(row[2]),
        open: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      });
    }
    cursor = chunkEnd + hour;
  }
  return validateHourlyKlines(result, "Coinbase");
}

/** OKX is the independent secondary K-line source. */
async function fetchOkxHourly(startTime: number, endTime: number) {
  const hour = 3_600_000;
  const result: ResearchKline[] = [];
  let cursor = endTime + 1;
  while (cursor >= startTime) {
    const params = new URLSearchParams({
      instId: "BTC-USDT",
      bar: "1H",
      after: String(cursor),
      limit: "300",
    });
    const response = await fetchWithTimeout(
      `${OKX_MARKET_API}/market/history-candles?${params}`
    );
    if (!response.ok) throw new Error(`OKX Kline ${response.status}`);
    const payload = (await response.json()) as {
      code?: string;
      msg?: string;
      data?: unknown[][];
    };
    if (payload.code !== "0" || !Array.isArray(payload.data))
      throw new Error(payload.msg || "OKX Kline 返回格式异常");
    if (!payload.data.length) break;
    let oldest = cursor;
    for (const row of payload.data) {
      const openTime = Number(row[0]);
      oldest = Math.min(oldest, openTime);
      if (openTime < startTime || openTime > endTime || row[8] === "0")
        continue;
      result.push({
        openTime,
        closeTime: openTime + hour - 1,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      });
    }
    if (oldest >= cursor || oldest <= startTime) break;
    cursor = oldest;
  }
  return validateHourlyKlines(result, "OKX");
}

async function fetchBinanceHourly(startTime: number, endTime: number) {
  const result: ResearchKline[] = [];
  let cursor = startTime;
  while (cursor <= endTime) {
    const params = new URLSearchParams({
      symbol: "BTCUSDT",
      interval: "1h",
      startTime: String(cursor),
      endTime: String(endTime),
      limit: "1000",
    });
    const response = await fetchWithTimeout(
      `${BINANCE_MARKET_API}/klines?${params}`
    );
    if (!response.ok) throw new Error(`Binance Kline ${response.status}`);
    const rows = (await response.json()) as unknown[][];
    if (!Array.isArray(rows)) throw new Error("Binance Kline 返回格式异常");
    for (const row of rows) {
      result.push({
        openTime: Number(row[0]),
        closeTime: Number(row[6]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      });
    }
    if (rows.length < 1000) break;
    const next = Number(rows.at(-1)?.[0]) + 3_600_000;
    if (!Number.isFinite(next) || next <= cursor) break;
    cursor = next;
  }
  return validateHourlyKlines(result, "Binance");
}

export function aggregateHourlyKlines(
  hourly: ResearchKline[],
  startTime: number,
  endTime: number,
  interval: ResearchKlineInterval
) {
  const duration = intervalMilliseconds(interval);
  const groups = new Map<number, ResearchKline[]>();
  for (const row of hourly) {
    if (row.openTime < startTime || row.openTime > endTime) continue;
    const bucket = Math.floor(row.openTime / duration) * duration;
    groups.set(bucket, [...(groups.get(bucket) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([openTime, rows]) => {
      const sorted = rows.sort((a, b) => a.openTime - b.openTime);
      return {
        openTime,
        closeTime: openTime + duration - 1,
        open: sorted[0].open,
        high: Math.max(...sorted.map(row => row.high)),
        low: Math.min(...sorted.map(row => row.low)),
        close: sorted.at(-1)!.close,
        volume: sorted.reduce((sum, row) => sum + row.volume, 0),
      };
    });
}

/** Fetch provider-neutral hourly candles and aggregate them on UTC boundaries. */
export async function fetchResearchMarketHistory(
  startDate: string,
  endDate: string,
  interval: ResearchKlineInterval
): Promise<MarketHistoryResponse> {
  assertIsoDate(startDate);
  assertIsoDate(endDate);
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`);
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days < 1 || days > MAX_INTRADAY_QUERY_DAYS)
    throw new Error(`日期范围必须为 1-${MAX_INTRADAY_QUERY_DAYS} 天`);
  const key = `${startDate}|${endDate}|${interval}`;
  const cached = marketCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Padding supplies the preceding 30 days for volatility and +/-24h backtests.
  const paddedStart = start - 31 * 86_400_000;
  const paddedEnd = Math.min(end + 25 * 3_600_000, Date.now());
  const attemptedSources: string[] = [];
  let hourlyKlines: ResearchKline[] | undefined;
  let source: MarketHistoryResponse["source"] = "Coinbase Exchange";
  let symbol: MarketHistoryResponse["symbol"] = "BTC-USD";
  try {
    hourlyKlines = await fetchCoinbaseHourly(paddedStart, paddedEnd);
    attemptedSources.push("Coinbase Exchange: success");
  } catch (error) {
    attemptedSources.push(
      `Coinbase Exchange: ${error instanceof Error ? error.message : "failed"}`
    );
  }
  if (!hourlyKlines) {
    try {
      hourlyKlines = await fetchOkxHourly(paddedStart, paddedEnd);
      source = "OKX Spot";
      symbol = "BTC-USDT";
      attemptedSources.push("OKX Spot: success");
    } catch (error) {
      attemptedSources.push(
        `OKX Spot: ${error instanceof Error ? error.message : "failed"}`
      );
    }
  }
  if (!hourlyKlines) {
    try {
      hourlyKlines = await fetchBinanceHourly(paddedStart, paddedEnd);
      source = "Binance Spot";
      symbol = "BTCUSDT";
      attemptedSources.push("Binance Spot: success");
    } catch (error) {
      attemptedSources.push(
        `Binance Spot: ${error instanceof Error ? error.message : "failed"}`
      );
    }
  }
  if (!hourlyKlines)
    throw new Error(`所有 BTC K线源均不可用：${attemptedSources.join("；")}`);
  const value: MarketHistoryResponse = {
    interval,
    displayKlines: aggregateHourlyKlines(hourlyKlines, start, end, interval),
    hourlyKlines,
    source,
    symbol,
    attemptedSources,
  };
  marketCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, value });
  return value;
}

export function getMaxPainCoverage() {
  return {
    provider: "SignalPlus" as const,
    primaryEndpoint: `${SIGNALPLUS_PRIMARY}${SIGNALPLUS_PATH}`,
    mirrorEndpoint: `${SIGNALPLUS_MIRROR}${SIGNALPLUS_PATH}`,
    earliestVerifiedDate: SIGNALPLUS_EARLIEST_VERIFIED_DATE,
    maximumDaysPerCalculation: MAX_INTRADAY_QUERY_DAYS,
    providerRangeLimit: "单个上游请求必须小于 2 天",
    observationHoursUtc: OBSERVATION_HOURS,
    retentionSla: false,
    ownershipNote:
      "返回值没有 exchange 字段；Deribit 风格合约名不等同于已证明的交易所归属。",
  };
}
