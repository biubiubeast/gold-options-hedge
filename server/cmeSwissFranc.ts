const CME_ROOT = "https://www.cmegroup.com/CmeWS/mvc/";
export const CME_SIX_S_REFERENCE_SOURCE =
  "CME public delayed/reference · CHF/USD options";

type CmeSeries = {
  productId: number;
  productIds?: number[];
  calendarEntries: {
    productCode: string;
    contractMonth: string;
    firstTrade: string;
    lastTrade: string;
  }[];
};
type CmeQuote = {
  quoteCode?: string;
  code?: string;
  last?: string;
  priorSettle?: string;
  bid?: string;
  ask?: string;
  bidSize?: string;
  askSize?: string;
  volume?: string;
  openInterest?: string;
  updated?: string;
};
type CmeChain = {
  tradeDate: string;
  quoteDelayed?: boolean;
  strikePrices: {
    strikePrice: string;
    underlyingFutureContract: string;
    call?: CmeQuote;
    put?: CmeQuote;
  }[];
};
type CmeSettlements = {
  tradeDate: string;
  settlements: { month: string; settle: string; volume?: string }[];
};
export type CmeReferenceOption = {
  symbol: string;
  expiry: string;
  expiryTimestamp: number;
  strike: number;
  optionType: "call" | "put";
  underlyingFuture: string;
  contractMultiplier: number;
  markPrice: number;
  markPriceKind: "mid" | "last" | "settlement" | "missing";
  bid1Price: number | null;
  ask1Price: number | null;
  bid1Size: number | null;
  ask1Size: number | null;
  ivReferenceSpot: number | null;
  ivReferenceTimestamp: number | null;
  ivReferenceSource: string | null;
  timestamp: number;
  source: string;
  volume: number | null;
  openInterest: number | null;
  tradeable: boolean;
};
export type CmeReferenceChain = {
  quotes: CmeReferenceOption[];
  spot: number;
  timestamp: number;
  source: string;
  feedKind: "delayed-reference";
  warnings: string[];
  requestedExpiryCount: number;
  loadedExpiryCount: number;
};

/** CME numeric quote cells sometimes append A/B to indicate an ask/bid. */
export function cmeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replaceAll(",", "").replace(/[AB]$/, "");
  if (!text || text === "-" || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text))
    return null;
  const result = Number(text);
  return Number.isFinite(result) ? result : null;
}

function dateOnly(value: string): string | null {
  const parsed = Date.parse(`${value} 12:00:00 GMT`);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : null;
}

/** Monthly/Friday CHF options terminate at 09:00 Chicago; honor DST. */
export function cmeExpiryTimestamp(date: string): number {
  const target = Date.parse(`${date}T09:00:00Z`);
  let result = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(result)
        .map(part => [part.type, part.value])
    );
    const localAsUtc = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`
    );
    result += target - localAsUtc;
  }
  return result;
}

function settlementAsOf(date: string): number {
  // This public field is date-only. Noon UTC is an explicit modelling
  // convention; do not label the quote's updated timestamp as a new settlement.
  return Date.parse(`${date}T12:00:00Z`);
}

function futureSettlementLabel(symbol: string, expiry: string): string | null {
  const matched = symbol.match(/^6S([HMUZ])(\d{1,2})$/);
  if (!matched) return null;
  const month = { H: "MAR", M: "JUN", U: "SEP", Z: "DEC" }[matched[1]];
  const expiryYear = Number(expiry.slice(0, 4));
  const year =
    matched[2].length === 2
      ? Number(matched[2])
      : Math.floor(expiryYear / 10) * 10 + Number(matched[2]);
  return `${month} ${String(year).slice(-2)}`;
}

export function normalizeCmeReferenceSeries(args: {
  chain: CmeChain;
  productCode: string;
  expiry: string;
  settlements: CmeSettlements | null;
  now: number;
}): CmeReferenceOption[] {
  const expiryTimestamp = cmeExpiryTimestamp(args.expiry);
  if (expiryTimestamp <= args.now) return [];
  const settlementDate = dateOnly(args.chain.tradeDate);
  const futuresDate = args.settlements
    ? dateOnly(args.settlements.tradeDate)
    : null;
  const rows = Array.isArray(args.chain.strikePrices)
    ? args.chain.strikePrices
    : [];
  return rows.flatMap(row => {
    const strike = cmeNumber(row.strikePrice);
    if (strike === null || strike <= 0) return [];
    const underlyingFuture = row.underlyingFutureContract;
    const matchedFuture = args.settlements?.settlements.find(
      future =>
        future.month === futureSettlementLabel(underlyingFuture, args.expiry)
    );
    const reference =
      futuresDate === settlementDate ? cmeNumber(matchedFuture?.settle) : null;
    return (["call", "put"] as const).flatMap(optionType => {
      const quote = row[optionType];
      if (!quote) return [];
      const symbol = String(quote.quoteCode || quote.code || "").trim();
      // Some calendar product IDs share a monthly request. Keep exactly the
      // selected series; never infer that a different option code has its expiry.
      const shortCode = args.productCode.replace(
        /(\d{2})$/,
        (_, year: string) => String(Number(year) % 10)
      );
      if (
        !symbol ||
        ![args.productCode, shortCode].some(code =>
          symbol.startsWith(`${code} `)
        )
      )
        return [];
      const bid = cmeNumber(quote.bid);
      const ask = cmeNumber(quote.ask);
      const last = cmeNumber(quote.last);
      const settlement = cmeNumber(quote.priorSettle);
      const hasMid = bid !== null && ask !== null && bid > 0 && ask >= bid;
      const markPriceKind = hasMid
        ? "mid"
        : last !== null && last > 0
          ? "last"
          : settlement !== null && settlement > 0
            ? "settlement"
            : "missing";
      const markPrice = hasMid
        ? (bid! + ask!) / 2
        : markPriceKind === "last"
          ? last!
          : markPriceKind === "settlement"
            ? settlement!
            : 0;
      const timestamp =
        markPriceKind === "settlement" && settlementDate
          ? settlementAsOf(settlementDate)
          : Date.parse(quote.updated || "") ||
            (settlementDate ? settlementAsOf(settlementDate) : 0);
      // Public futures data here is settlement-only. It can align with a
      // settlement premium, never with a later trade or BBO.
      const synchronizedReference =
        markPriceKind === "settlement" && reference !== null && reference > 0
          ? reference
          : null;
      return [
        {
          symbol,
          expiry: args.expiry,
          expiryTimestamp,
          strike,
          optionType,
          underlyingFuture,
          contractMultiplier: 125_000,
          markPrice,
          markPriceKind,
          bid1Price: bid,
          ask1Price: ask,
          bid1Size: cmeNumber(quote.bidSize),
          ask1Size: cmeNumber(quote.askSize),
          ivReferenceSpot: synchronizedReference,
          ivReferenceTimestamp:
            synchronizedReference !== null ? timestamp : null,
          ivReferenceSource:
            synchronizedReference !== null
              ? `CME ${underlyingFuture} settlement · ${settlementDate} · date-only (12:00 UTC modelling convention)`
              : null,
          timestamp,
          source: `${CME_SIX_S_REFERENCE_SOURCE} · ${markPriceKind === "settlement" ? `prior settlement ${settlementDate} (date-only)` : markPriceKind} · underlying ${underlyingFuture}`,
          volume: cmeNumber(quote.volume),
          openInterest: cmeNumber(quote.openInterest),
          tradeable: true,
        } satisfies CmeReferenceOption,
      ];
    });
  });
}

type PullJson = <T>(path: string) => Promise<T>;
const cache = new Map<string, { value: unknown; until: number }>();
const pending = new Map<string, Promise<unknown>>();
async function pullJson<T>(path: string): Promise<T> {
  const current = cache.get(path);
  if (current && current.until > Date.now()) return current.value as T;
  const existing = pending.get(path);
  if (existing) return existing as Promise<T>;
  const request = (async () => {
    const response = await fetch(`${CME_ROOT}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "GoldOptionsHedge/2.0",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`CME HTTP ${response.status}`);
    const value = await response.json();
    cache.set(path, {
      value,
      until:
        Date.now() +
        (path.startsWith("ProductCalendar") ? 60 * 60_000 : 5 * 60_000),
    });
    return value;
  })();
  pending.set(path, request);
  try {
    return (await request) as T;
  } finally {
    pending.delete(path);
  }
}

export async function getCmePublicSixSChain(
  now = Date.now(),
  pull: PullJson = pullJson
): Promise<CmeReferenceChain> {
  const calendar = await pull<CmeSeries[]>("ProductCalendar/Options/86");
  if (!Array.isArray(calendar)) throw new Error("CME calendar is unavailable");
  const series = calendar.flatMap(group =>
    (group.calendarEntries || []).flatMap(entry => {
      const expiry = dateOnly(entry.lastTrade);
      const firstTrade = dateOnly(entry.firstTrade);
      const month = dateOnly(`01 ${entry.contractMonth}`);
      if (
        !expiry ||
        !month ||
        !firstTrade ||
        Date.parse(`${firstTrade}T00:00:00Z`) > now ||
        cmeExpiryTimestamp(expiry) <= now
      )
        return [];
      // CHF monthly root CHU, Friday weekly roots 1SF…5SF. The calendar supplies
      // their product IDs; derive the weekly family index only from the real code.
      const weeklyIndex = Number(entry.productCode.match(/^([1-5])SF/)?.[1]);
      const productId = weeklyIndex
        ? group.productIds?.[weeklyIndex - 1]
        : group.productId;
      if (!productId) return [];
      return [
        {
          ...entry,
          expiry,
          year: Number(month.slice(0, 4)),
          month: Number(month.slice(5, 7)),
          productId,
        },
      ];
    })
  );
  const requests = new Map<string, typeof series>();
  for (const item of series) {
    const path = `atm/strike-prices/${item.productId}/${item.year}/${item.month}/ALL`;
    requests.set(path, [...(requests.get(path) || []), item]);
  }
  const warnings: string[] = [];
  const loaded: { chain: CmeChain; entries: typeof series }[] = [];
  const tasks = [...requests.entries()];
  // Bound fan-out to avoid overwhelming a small Render instance or CME.
  for (let index = 0; index < tasks.length; index += 4) {
    await Promise.all(
      tasks.slice(index, index + 4).map(async ([path, entries]) => {
        try {
          const chain = await pull<CmeChain>(path);
          if (!chain.strikePrices?.length)
            throw new Error("no listed strikes returned");
          loaded.push({ chain, entries });
        } catch (error) {
          warnings.push(
            `${entries.map(entry => entry.productCode).join(",")}: ${String(error)}`
          );
        }
      })
    );
  }
  const settlementDates = [
    ...new Set(
      loaded
        .map(item => dateOnly(item.chain.tradeDate))
        .filter((date): date is string => Boolean(date))
    ),
  ];
  const settlements = new Map<string, CmeSettlements>();
  await Promise.all(
    settlementDates.map(async date => {
      const formatted = `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
      try {
        const result = await pull<CmeSettlements>(
          `Settlements/Futures/Settlements/86/FUT?tradeDate=${formatted}&pageSize=100`
        );
        if (dateOnly(result.tradeDate) === date) settlements.set(date, result);
      } catch (error) {
        warnings.push(`Futures ${date}: ${String(error)}`);
      }
    })
  );
  const quoteMap = new Map<string, CmeReferenceOption>();
  for (const { chain, entries } of loaded) {
    const settlementDate = dateOnly(chain.tradeDate);
    for (const entry of entries) {
      for (const quote of normalizeCmeReferenceSeries({
        chain,
        productCode: entry.productCode,
        expiry: entry.expiry,
        settlements: settlementDate
          ? settlements.get(settlementDate) || null
          : null,
        now,
      }))
        quoteMap.set(quote.symbol, quote);
    }
  }
  const quotes = [...quoteMap.values()].sort(
    (a, b) =>
      a.expiry.localeCompare(b.expiry) ||
      a.strike - b.strike ||
      a.optionType.localeCompare(b.optionType)
  );
  if (!quotes.length)
    throw new Error(
      `CME returned no valid 6S options${warnings.length ? `: ${warnings[0]}` : ""}`
    );
  const latestDate = settlementDates.sort().at(-1);
  const futures = latestDate ? settlements.get(latestDate)?.settlements : [];
  const main = [...(futures || [])]
    .filter(future => (cmeNumber(future.settle) || 0) > 0)
    .sort((a, b) => (cmeNumber(b.volume) || 0) - (cmeNumber(a.volume) || 0))[0];
  return {
    quotes,
    spot: cmeNumber(main?.settle) || 0,
    timestamp: Math.max(...quotes.map(quote => quote.timestamp)),
    source: `${CME_SIX_S_REFERENCE_SOURCE} · monthly + Friday weekly · ${new Set(quotes.map(quote => quote.expiry)).size}/${series.length} expiries · settlement Model IV uses each option's own futures contract`,
    feedKind: "delayed-reference",
    warnings,
    requestedExpiryCount: series.length,
    loadedExpiryCount: new Set(quotes.map(quote => quote.expiry)).size,
  };
}

export function clearCmeSixSCache() {
  cache.clear();
}
