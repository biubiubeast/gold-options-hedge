import { blackScholes, timeToExpiry } from "@shared/blackScholes";
import { evaluateNamedFormula } from "@shared/formulaEngine";
import { DEFAULT_FORMULAS, type FormulaLike } from "@shared/marketTypes";
import type { DataStatus } from "@shared/riskHeatmap";
import type { HeatmapMetric } from "@shared/riskHeatmap";

export type HeatmapControlKey =
  | "dataset" | "underlying" | "venue" | "broker" | "account" | "callPut" | "expiryBucket" | "status"
  | "metric" | "scale" | "spot" | "label" | "hover" | "range" | "transpose" | "reverseStrikes"
  | "cellSize" | "fitAll" | "fullscreen";

export type HeatmapHoverField =
  | "selectedMetric" | "unitDelta" | "totalDelta" | "unitGamma" | "totalGamma" | "unitTheta" | "totalTheta"
  | "unitVega" | "totalVega" | "dteRoll" | "qtyNotional" | "markIv" | "bidAsk" | "bidAskIv"
  | "ivSpread" | "sourceQuote" | "openInterestVolume" | "mvEntry" | "upl";

export type HeatmapDetailField =
  | "instrument" | "underlyingCallPut" | "expiryDte" | "strike" | "venueBrokerAccount" | "netQty"
  | "contractMultiplier" | "xauPerUnit" | "markBidAsk" | "markIv" | "bidAskIv" | "qtyNotional"
  | "unitDelta" | "totalDelta" | "unitGamma" | "totalGamma" | "unitTheta" | "totalTheta"
  | "unitVega" | "totalVega" | "marketValue" | "entryPrice" | "entryCost" | "upl" | "source" | "quoteAsOf"
  | "dataStatus" | "deliverableSource" | "adjustedContract" | "rollPriority";

export type HeatmapExpiryHoverField =
  | "heldListed" | "totalDelta" | "totalGamma" | "totalTheta" | "totalVega" | "maxRoll" | "worstStatus"
  | "averageIv" | "openInterestVolume" | "staleMissing" | "latestQuote"
  | "netGrossQty" | "grossNotional" | "mvEntry" | "upl";

export type AdminPasswordPage = "dashboard" | "positions" | "matrix" | "formulas" | "dataSources" | "settings" | "optionDetail" | "notFound";

export type PortfolioPosition = {
  id: number;
  underlying: "XAUT" | "GLD" | "BTC";
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
  adminPasswordPages: Record<AdminPasswordPage, boolean>;
  visiblePages: {
    dashboard: boolean;
    positions: boolean;
    matrix: boolean;
    formulas: boolean;
    dataSources: boolean;
    settings: boolean;
  };
  marketAutoRefreshEnabled: boolean;
  marketAutoRefreshMinutes: number;
  pageMarketRefreshButtons: {
    positions: boolean;
    matrix: boolean;
  };
  heatmapClickActions: {
    cellDetail: boolean;
    expiryDetail: boolean;
  };
  heatmapVisibleFilters: {
    dataset: boolean;
    underlying: boolean;
    venue: boolean;
    broker: boolean;
    account: boolean;
    callPut: boolean;
    expiryBucket: boolean;
    status: boolean;
    metric: boolean;
    scale: boolean;
    spot: boolean;
    label: boolean;
    hover: boolean;
    range: boolean;
    transpose: boolean;
    reverseStrikes: boolean;
    cellSize: boolean;
    fitAll: boolean;
    fullscreen: boolean;
  };
  heatmapFilterOptions: {
    dataset: Record<"chain" | "live" | "mock100" | "mock200", boolean>;
    underlying: Record<"GLD" | "XAUT" | "BTC" | "all", boolean>;
    callPut: Record<"call" | "put" | "combined", boolean>;
    expiryBucket: Record<"all" | "expired" | "0-2" | "3-7" | "8-30" | "31+", boolean>;
    status: Record<DataStatus | "all", boolean>;
    metric: Record<HeatmapMetric, boolean>;
    scale: Record<"quantile" | "log" | "symmetric", boolean>;
    spot: Record<"GLD" | "XAUT" | "BTC" | "XAU", boolean>;
    label: Record<"none" | "held" | "top" | "bottom" | "all", boolean>;
    hover: Record<"risk" | "market" | "pnl" | "all", boolean>;
  };
  heatmapHiddenDynamicOptions: {
    venue: string[];
    broker: string[];
    account: string[];
  };
  heatmapHeldCellContent: {
    underlying: boolean;
    callPut: boolean;
    dataStatus: boolean;
  };
  heatmapHoverContent: Record<HeatmapHoverField, boolean>;
  heatmapExpiryHoverContent: Record<HeatmapExpiryHoverField, boolean>;
  heatmapDetailContent: Record<HeatmapDetailField, boolean>;
  heatmapVisibleSections: {
    decisionCards: boolean;
    dataError: boolean;
    scenario: boolean;
    chainStatusBanner: boolean;
    positionOnlyMetricBanner: boolean;
    chainContractCount: boolean;
  };
  heatmapChainContractCountLabel: string;
  xautContractMultiplier: number;
  gldContractMultiplier: number;
  btcContractMultiplier: number;
  xautSpotScaleOverride: number | null;
  gldSpotScaleOverride: number | null;
  btcSpotScaleOverride: number | null;
  gldFallbackIv: number;
  riskFreeRate: number;
};

export const DEFAULT_PORTFOLIO_SETTINGS: PortfolioSettings = {
  adminPasswordPages: {
    dashboard: true,
    positions: true,
    matrix: false,
    formulas: true,
    dataSources: true,
    settings: true,
    optionDetail: true,
    notFound: true,
  },
  visiblePages: {
    dashboard: false,
    positions: true,
    matrix: true,
    formulas: false,
    dataSources: false,
    settings: true,
  },
  marketAutoRefreshEnabled: true,
  marketAutoRefreshMinutes: 60,
  pageMarketRefreshButtons: {
    positions: false,
    matrix: false,
  },
  heatmapClickActions: {
    cellDetail: false,
    expiryDetail: false,
  },
  heatmapVisibleFilters: {
    dataset: false,
    underlying: true,
    venue: false,
    broker: false,
    account: false,
    callPut: true,
    expiryBucket: false,
    status: false,
    metric: true,
    scale: false,
    spot: false,
    label: true,
    hover: true,
    range: true,
    transpose: false,
    reverseStrikes: true,
    cellSize: true,
    fitAll: true,
    fullscreen: true,
  },
  heatmapFilterOptions: {
    dataset: { chain: true, live: true, mock100: true, mock200: true },
    underlying: { GLD: true, XAUT: true, BTC: true, all: false },
    callPut: { call: true, put: true, combined: false },
    expiryBucket: { all: true, expired: true, "0-2": true, "3-7": true, "8-30": true, "31+": true },
    status: { all: true, LIVE: true, STALE: true, WARN: true, MISSING: true, FAIL: true },
    metric: {
      unitDelta: true,
      totalDelta: true,
      gamma: false,
      theta: false,
      vega: false,
      markIV: true,
      bidIV: true,
      askIV: true,
      ivSpread: true,
      qty: true,
      notionalSize: true,
      bidDollarNotional: true,
      askDollarNotional: true,
      bidAskDollarNotional: true,
      MV: false,
      UPL: false,
      DTE: false,
      distanceToStrike: false,
      rollPriority: false,
    },
    scale: { quantile: true, log: true, symmetric: true },
    spot: { GLD: true, XAUT: true, BTC: true, XAU: true },
    label: { none: true, held: true, top: false, bottom: false, all: true },
    hover: { risk: true, market: true, pnl: true, all: true },
  },
  heatmapHiddenDynamicOptions: { venue: [], broker: [], account: [] },
  heatmapHoverContent: {
    selectedMetric: true,
    unitDelta: true,
    totalDelta: true,
    unitGamma: false,
    totalGamma: false,
    unitTheta: false,
    totalTheta: false,
    unitVega: false,
    totalVega: false,
    dteRoll: false,
    qtyNotional: true,
    markIv: true,
    bidAsk: true,
    bidAskIv: true,
    ivSpread: true,
    sourceQuote: true,
    openInterestVolume: true,
    mvEntry: true,
    upl: true,
  },
  heatmapExpiryHoverContent: {
    heldListed: true,
    totalDelta: true,
    totalGamma: false,
    totalTheta: false,
    totalVega: false,
    maxRoll: false,
    worstStatus: true,
    averageIv: true,
    openInterestVolume: true,
    staleMissing: true,
    latestQuote: true,
    netGrossQty: true,
    grossNotional: true,
    mvEntry: true,
    upl: true,
  },
  heatmapHeldCellContent: {
    underlying: true,
    callPut: true,
    dataStatus: true,
  },
  heatmapDetailContent: {
    instrument: true,
    underlyingCallPut: true,
    expiryDte: true,
    strike: true,
    venueBrokerAccount: true,
    netQty: true,
    contractMultiplier: true,
    xauPerUnit: true,
    markBidAsk: true,
    markIv: true,
    bidAskIv: true,
    qtyNotional: true,
    unitDelta: true,
    totalDelta: true,
    unitGamma: false,
    totalGamma: false,
    unitTheta: false,
    totalTheta: false,
    unitVega: false,
    totalVega: false,
    marketValue: true,
    entryPrice: true,
    entryCost: true,
    upl: true,
    source: true,
    quoteAsOf: true,
    dataStatus: true,
    deliverableSource: true,
    adjustedContract: true,
    rollPriority: false,
  },
  heatmapVisibleSections: {
    decisionCards: false,
    dataError: false,
    scenario: false,
    chainStatusBanner: false,
    positionOnlyMetricBanner: false,
    chainContractCount: false,
  },
  heatmapChainContractCountLabel: "完整期权链合约数（Call + Put，筛选前）",
  xautContractMultiplier: 1,
  gldContractMultiplier: 100,
  btcContractMultiplier: 1,
  xautSpotScaleOverride: null,
  gldSpotScaleOverride: 0.092,
  btcSpotScaleOverride: null,
  gldFallbackIv: 0.2,
  riskFreeRate: 0.045,
};

export type MarketSnapshot = {
  markPrice: number;
  markIv: number;
  bid1: number;
  ask1: number;
  bidSize: number | null;
  askSize: number | null;
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
  bid1Size?: string;
  ask1Size?: string;
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
  bid1Size?: number | null;
  ask1Size?: number | null;
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
    bidSize: null,
    askSize: null,
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
  btcTickers?: XautTicker[];
  gldQuotes?: GldQuote[];
  gldSpot: number;
  formulas?: readonly FormulaLike[];
  settings: PortfolioSettings;
}): MarketSnapshot {
  const { position, xautTickers, btcTickers, gldQuotes, gldSpot, settings } = args;
  const formulas = args.formulas?.length ? args.formulas : DEFAULT_FORMULAS;

  if (position.underlying === "XAUT" || position.underlying === "BTC") {
    const ticker = findXautTicker(position, position.underlying === "BTC" ? btcTickers : xautTickers);
    if (ticker) {
      return {
        markPrice: numberOf(ticker.markPrice),
        markIv: numberOf(ticker.markIv),
        bid1: numberOf(ticker.bid1Price),
        ask1: numberOf(ticker.ask1Price),
        bidSize: finiteImported(ticker.bid1Size),
        askSize: finiteImported(ticker.ask1Size),
        bidIv: finiteImported(ticker.bid1Iv),
        askIv: finiteImported(ticker.ask1Iv),
        delta: numberOf(ticker.delta),
        gamma: numberOf(ticker.gamma),
        theta: numberOf(ticker.theta),
        vega: numberOf(ticker.vega),
        source: `Bybit V5 · ${position.underlying}`,
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
        bidSize: finiteImported(quote.bid1Size),
        askSize: finiteImported(quote.ask1Size),
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
        bidSize: null,
        askSize: null,
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
    bidSize: null,
    askSize: null,
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
  btcSpot: number;
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
    : position.underlying === "GLD" ? settings.gldContractMultiplier
    : position.underlying === "BTC" ? settings.btcContractMultiplier
    : settings.xautContractMultiplier;
  const underlyingPrice = position.underlying === "GLD" ? args.gldSpot : position.underlying === "BTC" ? args.btcSpot : args.xautSpot;
  const automaticScale = args.xauSpot > 0 && underlyingPrice > 0 ? underlyingPrice / args.xauSpot : 1;
  const override = position.underlying === "GLD"
    ? settings.gldSpotScaleOverride
    : position.underlying === "BTC" ? settings.btcSpotScaleOverride : settings.xautSpotScaleOverride;
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
