import { blackScholes, timeToExpiry } from "@shared/blackScholes";
import { evaluateNamedFormula } from "@shared/formulaEngine";
import { DEFAULT_FORMULAS, type FormulaLike } from "@shared/marketTypes";
import type { DataStatus } from "@shared/riskHeatmap";

export type PortfolioPosition = {
  id: number;
  underlying: "XAUT" | "GLD";
  expiry: string;
  strike: string;
  optionType: "call" | "put";
  entryPrice: string;
  quantity: string;
  fee: string;
  entryDelta: string;
  sourceAccount?: string | null;
  venue?: string | null;
  instrument?: string | null;
  product?: string | null;
  currency?: "USD" | "USDT" | null;
  qtyLong?: string | null;
  qtyShort?: string | null;
  multiplierXau?: string | null;
  xauEqNetQty?: string | null;
  referenceDate?: string | null;
  importedMarkPrice?: string | null;
  markIv?: string | null;
  bid1Price?: string | null;
  ask1Price?: string | null;
  marketQuoteTime?: string | null;
  marketSource?: string | null;
  lastMarketRefreshAt?: string | null;
  openInterest?: string | null;
  optionVolume?: string | null;
  importedMarketValue?: string | null;
  entryValue?: string | null;
  importedEntryCost?: string | null;
  importedUnrealizedPnl?: string | null;
  importedUnrealizedPnlPct?: string | null;
  importedTotalDeltaXau?: string | null;
  importedTotalGammaXau?: string | null;
  importedTotalThetaUsdDay?: string | null;
  importedTotalVegaUsdVol?: string | null;
  unitGamma?: string | null;
  unitTheta?: string | null;
  unitVega?: string | null;
  contractMultiplier?: string | null;
  rawMarginMode?: string | null;
  rawMarginType?: string | null;
  importSource?: string | null;
  importRow?: number | null;
  dataStatus?: DataStatus;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type PortfolioSettings = {
  xautContractMultiplier: number;
  gldContractMultiplier: number;
  xautSpotScaleOverride: number | null;
  gldSpotScaleOverride: number | null;
  gldFallbackIv: number;
  riskFreeRate: number;
};

export const DEFAULT_PORTFOLIO_SETTINGS: PortfolioSettings = {
  xautContractMultiplier: 1,
  gldContractMultiplier: 100,
  xautSpotScaleOverride: null,
  gldSpotScaleOverride: null,
  gldFallbackIv: 0.2,
  riskFreeRate: 0.045,
};

export type MarketSnapshot = {
  markPrice: number;
  markIv: number;
  bid1: number;
  ask1: number;
  bidIv?: number | null;
  askIv?: number | null;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  source: string;
  estimated: boolean;
  available: boolean;
  quoteTime: string | null;
  dataStatus: DataStatus;
};

type XautTicker = {
  symbol: string;
  markPrice: string;
  markIv: string;
  bid1Price: string;
  ask1Price: string;
  bid1Iv?: string;
  ask1Iv?: string;
  delta: string;
  gamma: string;
  theta: string;
  vega: string;
  timestamp?: number;
};
type GldQuote = {
  expiry: string;
  strike: number;
  optionType: "call" | "put";
  markPrice: number;
  markIv: number;
  bid1Price: number;
  ask1Price: number;
  bidIv?: number | null;
  askIv?: number | null;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  source: string;
  timestamp?: number;
};

const quoteIso = (value: unknown): string | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed > 10_000_000_000 ? parsed : parsed * 1000).toISOString();
};

const quoteStatus = (value: unknown): DataStatus => {
  const iso = quoteIso(value);
  if (!iso) return "MISSING";
  return Date.now() - Date.parse(iso) > 15 * 60_000 ? "STALE" : "LIVE";
};

const numberOf = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const finiteImported = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function importedSnapshot(position: PortfolioPosition): MarketSnapshot | null {
  const markPrice = finiteImported(position.importedMarkPrice);
  const delta = finiteImported(position.entryDelta);
  const gamma = finiteImported(position.unitGamma);
  const theta = finiteImported(position.unitTheta);
  const vega = finiteImported(position.unitVega);
  if ([markPrice, delta, gamma, theta, vega].some(value => value === null)) return null;
  const quoteTime = position.marketQuoteTime ?? (position.referenceDate ? `${position.referenceDate}T23:59:59.000Z` : null);
  const age = quoteTime ? Date.now() - Date.parse(quoteTime) : Number.POSITIVE_INFINITY;
  return {
    markPrice: markPrice!,
    markIv: finiteImported(position.markIv) ?? 0,
    bid1: finiteImported(position.bid1Price) ?? 0,
    ask1: finiteImported(position.ask1Price) ?? 0,
    delta: delta!,
    gamma: gamma!,
    theta: theta!,
    vega: vega!,
    source: position.marketSource ?? `Excel · ${position.importSource ?? "position snapshot"}${position.importRow ? ` · row ${position.importRow}` : ""}`,
    estimated: false,
    available: true,
    quoteTime,
    dataStatus: position.dataStatus ?? (!quoteTime ? "WARN" : age > 15 * 60_000 ? "STALE" : "LIVE"),
  };
}

export function bybitExpiry(expiry: string): string {
  const [year, month, day] = expiry.split("-").map(Number);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${day}${months[month - 1]}${String(year).slice(2)}`;
}

export function findXautTicker(position: PortfolioPosition, tickers?: XautTicker[]) {
  if (!tickers) return undefined;
  const expiryToken = bybitExpiry(position.expiry);
  const strike = numberOf(position.strike);
  const typeToken = position.optionType === "call" ? "C" : "P";
  return tickers.find(ticker => {
    const tokens = ticker.symbol.toUpperCase().split("-");
    const strikeMatches = tokens.some(token => numberOf(token) === strike && token !== "0");
    const typeMatches = tokens.includes(typeToken);
    return ticker.symbol.toUpperCase().includes(expiryToken) && strikeMatches && typeMatches;
  });
}

export function getPositionMarketData(args: {
  position: PortfolioPosition;
  xautTickers?: XautTicker[];
  gldQuotes?: GldQuote[];
  gldSpot: number;
  formulas?: readonly FormulaLike[];
  settings: PortfolioSettings;
}): MarketSnapshot {
  const { position, xautTickers, gldQuotes, gldSpot, settings } = args;
  const formulas = args.formulas?.length ? args.formulas : DEFAULT_FORMULAS;

  if (position.underlying === "XAUT") {
    const ticker = findXautTicker(position, xautTickers);
    if (ticker) {
      return {
        markPrice: numberOf(ticker.markPrice),
        markIv: numberOf(ticker.markIv),
        bid1: numberOf(ticker.bid1Price),
        ask1: numberOf(ticker.ask1Price),
        bidIv: finiteImported(ticker.bid1Iv),
        askIv: finiteImported(ticker.ask1Iv),
        delta: numberOf(ticker.delta),
        gamma: numberOf(ticker.gamma),
        theta: numberOf(ticker.theta),
        vega: numberOf(ticker.vega),
        source: "Bybit V5",
        estimated: false,
        available: true,
        quoteTime: quoteIso(ticker.timestamp),
        dataStatus: quoteStatus(ticker.timestamp),
      };
    }
    const imported = importedSnapshot(position);
    if (imported) return imported;
  }

  if (position.underlying === "GLD") {
    const quote = gldQuotes?.find(item =>
      item.expiry === position.expiry &&
      item.optionType === position.optionType &&
      Math.abs(item.strike - numberOf(position.strike)) < 0.001,
    );
    if (quote) {
      return {
        markPrice: numberOf(quote.markPrice),
        markIv: numberOf(quote.markIv),
        bid1: numberOf(quote.bid1Price),
        ask1: numberOf(quote.ask1Price),
        bidIv: finiteImported(quote.bidIv),
        askIv: finiteImported(quote.askIv),
        delta: numberOf(quote.delta),
        gamma: numberOf(quote.gamma),
        theta: numberOf(quote.theta),
        vega: numberOf(quote.vega),
        source: quote.source,
        estimated: false,
        available: true,
        quoteTime: quoteIso(quote.timestamp),
        dataStatus: quoteStatus(quote.timestamp),
      };
    }
    const imported = importedSnapshot(position);
    if (imported) return imported;
    if (gldSpot > 0) {
      const result = blackScholes({
        S: gldSpot,
        K: numberOf(position.strike),
        T: timeToExpiry(position.expiry),
        r: settings.riskFreeRate,
        sigma: settings.gldFallbackIv,
        type: position.optionType,
      }, formulas);
      return {
        markPrice: result.price,
        markIv: settings.gldFallbackIv,
        bid1: 0,
        ask1: 0,
        delta: result.delta,
        gamma: result.gamma,
        theta: result.theta,
        vega: result.vega,
        source: "Black-Scholes 估算",
        estimated: true,
        available: true,
        quoteTime: null,
        dataStatus: "WARN",
      };
    }
  }

  return {
    markPrice: 0,
    markIv: 0,
    bid1: 0,
    ask1: 0,
    delta: numberOf(position.entryDelta),
    gamma: 0,
    theta: 0,
    vega: 0,
    source: "行情不可用",
    estimated: true,
    available: false,
    quoteTime: null,
    dataStatus: "MISSING",
  };
}

function calculate(
  name: string,
  variables: Record<string, number>,
  formulas: readonly FormulaLike[],
  fallback: number,
): number {
  try {
    return evaluateNamedFormula(name, variables, formulas, new Set());
  } catch {
    return fallback;
  }
}

export function calculatePosition(args: {
  position: PortfolioPosition;
  market: MarketSnapshot;
  xautSpot: number;
  gldSpot: number;
  xauSpot: number;
  formulas?: readonly FormulaLike[];
  settings: PortfolioSettings;
}) {
  const { position, market, settings } = args;
  const formulas = args.formulas?.length ? args.formulas : DEFAULT_FORMULAS;
  const quantity = numberOf(position.quantity);
  const entryPrice = numberOf(position.entryPrice);
  const fee = numberOf(position.fee);
  const importedContractMultiplier = finiteImported(position.contractMultiplier);
  const contractMultiplier = importedContractMultiplier && importedContractMultiplier > 0
    ? importedContractMultiplier
    : position.underlying === "GLD" ? settings.gldContractMultiplier : settings.xautContractMultiplier;
  const underlyingPrice = position.underlying === "GLD" ? args.gldSpot : args.xautSpot;
  const automaticScale = args.xauSpot > 0 && underlyingPrice > 0 ? underlyingPrice / args.xauSpot : 1;
  const override = position.underlying === "GLD"
    ? settings.gldSpotScaleOverride
    : settings.xautSpotScaleOverride;
  const importedSpotScale = finiteImported(position.multiplierXau);
  const spotScale = importedSpotScale ?? override ?? calculate("spot_scale", {
    underlyingPrice,
    xauUsdPrice: args.xauSpot || underlyingPrice || 1,
  }, formulas, automaticScale);

  const baseVariables = {
    entryPrice,
    quantity,
    fee,
    markPrice: market.markPrice,
    contractMultiplier,
    delta: market.delta,
    gamma: market.gamma,
    theta: market.theta,
    vega: market.vega,
    spotScale,
    underlyingPrice,
    xauUsdPrice: args.xauSpot,
  };
  const entryCost = calculate(
    "entry_cost",
    baseVariables,
    formulas,
    entryPrice * quantity * contractMultiplier + fee,
  );
  const currentValue = calculate(
    "current_value",
    baseVariables,
    formulas,
    market.markPrice * quantity * contractMultiplier,
  );
  const notionalSize = calculate(
    "notional_size",
    baseVariables,
    formulas,
    quantity * contractMultiplier * underlyingPrice,
  );
  const pnl = calculate("pnl", { ...baseVariables, entryCost, currentValue }, formulas, currentValue - entryCost);

  return {
    entryCost,
    currentValue,
    notionalSize,
    pnl,
    contractMultiplier,
    spotScale,
    totalDeltaRaw: market.delta * quantity * contractMultiplier,
    totalGammaRaw: market.gamma * quantity * contractMultiplier,
    totalDeltaXau: calculate(
      "total_delta_xau",
      baseVariables,
      formulas,
      market.delta * quantity * contractMultiplier * spotScale,
    ),
    totalGammaXau: calculate(
      "total_gamma_xau",
      baseVariables,
      formulas,
      market.gamma * quantity * contractMultiplier * spotScale ** 2,
    ),
    totalTheta: calculate(
      "total_theta",
      baseVariables,
      formulas,
      market.theta * quantity * contractMultiplier,
    ),
    totalVega: calculate(
      "total_vega",
      baseVariables,
      formulas,
      market.vega * quantity * contractMultiplier,
    ),
  };
}
