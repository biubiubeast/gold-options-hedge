import { blackScholes } from "./blackScholes";
import { evaluateNamedFormula } from "./formulaEngine";
import { DEFAULT_FORMULAS, type FormulaLike } from "./marketTypes";

export type RiskUnderlying = "GLD" | "XAUT" | "BTC";
export type CallPut = "call" | "put";
export type DataStatus = "LIVE" | "STALE" | "WARN" | "MISSING" | "FAIL";
export type PlannedAction = "HOLD" | "CLOSE" | "ROLL" | "EXERCISE ALLOWED" | "DNE";
export type HeatmapMetric =
  | "unitDelta"
  | "totalDelta"
  | "gamma"
  | "theta"
  | "vega"
  | "markIV"
  | "bidIV"
  | "askIV"
  | "ivSpread"
  | "qty"
  | "notionalSize"
  | "bidDollarNotional"
  | "askDollarNotional"
  | "bidAskDollarNotional"
  | "MV"
  | "UPL"
  | "DTE"
  | "distanceToStrike"
  | "rollPriority";
export type ColorScaleMode = "quantile" | "log" | "symmetric";
export type ExpiryBucket = "all" | "expired" | "0-2" | "3-7" | "8-30" | "31+";
export type MoneynessFilter = "all" | "itm" | "otm";
export type OptionMoneyness = "ITM" | "ATM" | "OTM";

export interface RiskPosition {
  id: string;
  venue: string;
  broker: string;
  account: string;
  underlying: RiskUnderlying;
  instrument: string;
  callPut: CallPut;
  expiry: string;
  strike: number;
  netQty: number;
  contractMultiplier: number | null;
  deliverableSource: string | null;
  contractAdjusted: boolean;
  gldOzPerShare: number | null;
  underlyingOzPerUnit: number | null;
  markPrice: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  markIV: number | null;
  bidIV: number | null;
  askIV: number | null;
  ivSpread: number | null;
  unitDelta: number | null;
  unitGamma: number | null;
  unitTheta: number | null;
  unitVega: number | null;
  totalDeltaXAU: number | null;
  totalGammaXAU: number | null;
  totalThetaUSD: number | null;
  totalVegaUSD: number | null;
  MV: number | null;
  entryPrice: number | null;
  entryCost: number | null;
  UPL: number | null;
  /** Optional precomputed signed underlying notional from the editable formula engine. */
  notionalSizeUSD?: number | null;
  quoteTime: string | null;
  positionTime: string | null;
  source: string | null;
  dataStatus: DataStatus;
  positionKind?: "held" | "listed";
  openInterest?: number | null;
  volume?: number | null;
  availableUSD?: number | null;
  buyingPower?: number | null;
  officialClose?: number | null;
  brokerCutoff?: string | null;
  plannedAction?: PlannedAction | null;
  owner?: string | null;
  reviewer?: string | null;
  confirmationId?: string | null;
}

export interface RollFactor {
  key: string;
  label: string;
  weight: number;
  score: number;
  contribution: number;
  reason: string;
}

export interface RollPriority {
  total: number;
  factors: RollFactor[];
}

export interface EnrichedRiskPosition extends RiskPosition {
  dte: number;
  /** Signed underlying notional: netQty × contractMultiplier × underlying spot. */
  notionalSizeUSD: number | null;
  bidDollarNotional: number | null;
  askDollarNotional: number | null;
  bidAskDollarNotional: number | null;
  distanceToStrike: number | null;
  spreadPct: number | null;
  intrinsicValue: number | null;
  timeValue: number | null;
  quoteAgeSeconds: number | null;
  rollPriority: RollPriority;
}

export interface HeatLegendBin {
  from: number;
  to: number;
  label: string;
  normalized: number;
}

export interface MetricDistribution {
  min: number | null;
  p25: number | null;
  median: number | null;
  average: number | null;
  p75: number | null;
  max: number | null;
  validCount: number;
  missingCount: number;
}

export interface HeatScale {
  mode: ColorScaleMode;
  centered: boolean;
  rangeBasis: "distribution" | "custom" | "held";
  clipLow: number;
  clipHigh: number;
  p99Abs: number;
  bins: HeatLegendBin[];
  custom: boolean;
  normalize: (value: number) => number;
}

export interface ScenarioInput {
  xauShockPct: number;
  ivShockPoints: number;
  day: 0 | 1 | 3 | 7;
  vanNakedDeltaXau: number;
  spots: Record<RiskUnderlying, number> & { XAU: number };
}

export interface ScenarioResult {
  optionPnlUSD: number;
  gldPnlUSD: number;
  xautPnlUSD: number;
  btcPnlUSD: number;
  vanNakedPnlUSD: number;
  residualPnlUSD: number;
  stressedDeltaXAU: number;
  stressCoveragePct: number | null;
  missingCount: number;
}

export interface ExerciseControl {
  positionId: string;
  label: string;
  dte: number;
  spotDistancePct: number | null;
  estimatedFundingUSD: number | null;
  availableFundingUSD: number | null;
  fundingCoveragePct: number | null;
  likelyITM: boolean | null;
  brokerCutoff: string | null;
  plannedAction: PlannedAction;
  owner: string | null;
  reviewer: string | null;
  confirmationId: string | null;
  status: DataStatus;
}

export type SpotRangeState = {
  state: "within" | "above" | "below" | "missing";
  nearestStrike: number | null;
};

const DAY_MS = 86_400_000;

export const METRIC_LABELS: Record<HeatmapMetric, string> = {
  unitDelta: "Unit Delta",
  totalDelta: "Total Delta XAU",
  gamma: "Gamma XAU",
  theta: "Theta USD/day",
  vega: "Vega USD/vol",
  markIV: "Mark IV",
  bidIV: "Bid IV",
  askIV: "Ask IV",
  ivSpread: "Bid Ask IV Spread",
  qty: "Raw Qty",
  notionalSize: "Notional Size USD",
  bidDollarNotional: "Bid Dollar Notional",
  askDollarNotional: "Ask Dollar Notional",
  bidAskDollarNotional: "Bid+Ask Dollar Notional",
  MV: "Market Value",
  UPL: "UPL",
  DTE: "DTE",
  distanceToStrike: "Distance to Strike",
  rollPriority: "Roll Priority",
};

export const CENTERED_METRICS = new Set<HeatmapMetric>([
  "unitDelta",
  "totalDelta",
  "gamma",
  "theta",
  "vega",
  "MV",
  "UPL",
  "distanceToStrike",
]);

/** These metrics describe an owned position, not a listed option contract. */
export const HELD_ONLY_HEATMAP_METRICS = new Set<HeatmapMetric>([
  "qty",
  "notionalSize",
]);

export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * p));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function daysToExpiry(expiry: string, asOf: Date = new Date()): number {
  const [year, month, day] = expiry.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return Number.NaN;
  const expiryDay = Date.UTC(year, month - 1, day);
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.round((expiryDay - asOfDay) / DAY_MS);
}

/** Default ALL is the active market surface; expired contracts require an explicit audit filter. */
export function expiryBucketMatchesDte(dte: number, bucket: ExpiryBucket): boolean {
  if (!Number.isFinite(dte)) return false;
  if (bucket === "all") return dte >= 0;
  if (bucket === "expired") return dte < 0;
  if (bucket === "0-2") return dte >= 0 && dte <= 2;
  if (bucket === "3-7") return dte >= 3 && dte <= 7;
  if (bucket === "8-30") return dte >= 8 && dte <= 30;
  return dte >= 31;
}

export function positionLabel(position: Pick<RiskPosition, "underlying" | "expiry" | "strike" | "callPut">): string {
  return `${position.underlying} ${position.expiry.slice(5)} ${formatPrice(position.strike)}${position.callPut === "call" ? "C" : "P"}`;
}

export function metricValue(position: EnrichedRiskPosition, metric: HeatmapMetric): number | null {
  switch (metric) {
    case "unitDelta": return position.unitDelta;
    case "totalDelta": return position.totalDeltaXAU;
    case "gamma": return position.totalGammaXAU;
    case "theta": return position.totalThetaUSD;
    case "vega": return position.totalVegaUSD;
    case "markIV": return position.markIV;
    case "bidIV": return position.bidIV;
    case "askIV": return position.askIV;
    case "ivSpread": return position.ivSpread;
    case "qty": return position.netQty;
    case "notionalSize": return position.notionalSizeUSD;
    case "bidDollarNotional": return position.bidDollarNotional;
    case "askDollarNotional": return position.askDollarNotional;
    case "bidAskDollarNotional": return position.bidAskDollarNotional;
    case "MV": return position.MV;
    case "UPL": return position.UPL;
    case "DTE": return Number.isFinite(position.dte) ? position.dte : null;
    case "distanceToStrike": return position.distanceToStrike;
    case "rollPriority": return position.rollPriority.total;
  }
}

export function aggregateMetric(positions: EnrichedRiskPosition[], metric: HeatmapMetric): number | null {
  const values = positions
    .map(position => metricValue(position, metric))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return null;
  if (metric === "unitDelta" || metric === "distanceToStrike") {
    return values.reduce((selected, value) => Math.abs(value) > Math.abs(selected) ? value : selected, values[0]);
  }
  if (metric === "markIV" || metric === "bidIV" || metric === "askIV" || metric === "ivSpread" || metric === "rollPriority") return Math.max(...values);
  if (metric === "DTE") return Math.min(...values);
  return values.reduce((sum, value) => sum + value, 0);
}

export function aggregateHeatmapCellMetric(positions: EnrichedRiskPosition[], metric: HeatmapMetric): number | null {
  const eligible = HELD_ONLY_HEATMAP_METRICS.has(metric)
    ? positions.filter(position => position.positionKind !== "listed")
    : positions;
  if (eligible.length === 0) return null;
  // Never grade a partially known cell. If any contract needed by the selected
  // metric is missing, the entire cell remains visibly listed but uncoloured.
  if (eligible.some(position => {
    const value = metricValue(position, metric);
    return value === null || !Number.isFinite(value);
  })) return null;
  return aggregateMetric(eligible, metric);
}

/** Distribution of the currently selected heatmap metric for an Expiry. */
export function metricDistribution(positions: EnrichedRiskPosition[], metric: HeatmapMetric): MetricDistribution {
  const eligible = HELD_ONLY_HEATMAP_METRICS.has(metric)
    ? positions.filter(position => position.positionKind !== "listed")
    : positions;
  const values = eligible
    .map(position => metricValue(position, metric))
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((left, right) => left - right);
  return {
    min: values.length ? values[0] : null,
    p25: values.length ? percentile(values, 0.25) : null,
    median: values.length ? percentile(values, 0.5) : null,
    average: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null,
    p75: values.length ? percentile(values, 0.75) : null,
    max: values.length ? values[values.length - 1] : null,
    validCount: values.length,
    missingCount: eligible.length - values.length,
  };
}

export type ExpiryHeldMetricTotal = {
  label: "Total Delta" | "Total Notional Size USD" | "Total Qty";
  value: number | null;
};

/** Additional Expiry summary shown only for additive position metrics. */
export function expiryHeldMetricTotal(
  positions: EnrichedRiskPosition[],
  metric: HeatmapMetric,
): ExpiryHeldMetricTotal | null {
  const label = metric === "totalDelta"
    ? "Total Delta"
    : metric === "notionalSize"
      ? "Total Notional Size USD"
      : metric === "qty"
        ? "Total Qty"
        : null;
  if (label === null) return null;
  const held = positions.filter(position => position.positionKind !== "listed");
  if (held.length === 0) return { label, value: null };
  const values = held.map(position => metricValue(position, metric));
  if (values.some(value => value === null || !Number.isFinite(value))) return { label, value: null };
  return { label, value: (values as number[]).reduce((total, value) => total + value, 0) };
}

export function quoteAgeSeconds(position: RiskPosition, asOf: Date = new Date()): number | null {
  if (!position.quoteTime) return null;
  const timestamp = Date.parse(position.quoteTime);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((asOf.getTime() - timestamp) / 1000));
}

export function spotRangeState(strikes: number[], spot: number): SpotRangeState {
  const valid = strikes.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0 || !Number.isFinite(spot) || spot <= 0) return { state: "missing", nearestStrike: null };
  if (spot < valid[0]) return { state: "below", nearestStrike: valid[0] };
  if (spot > valid[valid.length - 1]) return { state: "above", nearestStrike: valid[valid.length - 1] };
  return {
    state: "within",
    nearestStrike: valid.reduce((nearest, strike) => Math.abs(strike - spot) < Math.abs(nearest - spot) ? strike : nearest, valid[0]),
  };
}

/** Signed strike distance versus spot: (strike - spot) / spot. */
export function strikeDistanceFromSpot(strike: number, spot: number): number | null {
  if (!Number.isFinite(strike) || !Number.isFinite(spot) || spot <= 0) return null;
  return (strike - spot) / spot;
}

export function formatStrikeDistanceFromSpot(strike: number, spot: number): string {
  const distance = strikeDistanceFromSpot(strike, spot);
  if (distance === null) return "MISSING";
  const percentage = distance * 100;
  return `${percentage < 0 ? "−" : "+"}${Math.abs(percentage).toFixed(2)}%`;
}

/** Return exactly the closest listed strike levels to spot (ties: lower first). */
export function nearestStrikeLevels(strikes: number[], spot: number, count = 1): number[] {
  if (!Number.isFinite(spot) || spot <= 0 || count <= 0) return [];
  return [...new Set(strikes.filter(strike => Number.isFinite(strike)))]
    .sort((left, right) => Math.abs(left - spot) - Math.abs(right - spot) || left - right)
    .slice(0, count);
}

export function classifyOptionMoneyness(
  strike: number,
  spot: number,
  callPut: CallPut,
  atmStrike: number | null,
): OptionMoneyness | null {
  if (!Number.isFinite(strike) || !Number.isFinite(spot) || spot <= 0) return null;
  if (atmStrike !== null && strike === atmStrike) return "ATM";
  const itm = callPut === "call" ? strike < spot : strike > spot;
  return itm ? "ITM" : "OTM";
}

function statusSeverity(status: DataStatus): number {
  return ({ LIVE: 0, WARN: 1, STALE: 2, MISSING: 3, FAIL: 4 })[status];
}

export function worstStatus(positions: Pick<RiskPosition, "dataStatus">[]): DataStatus {
  return positions.reduce<DataStatus>((worst, position) =>
    statusSeverity(position.dataStatus) > statusSeverity(worst) ? position.dataStatus : worst,
  "LIVE");
}

export function deriveDataStatus(position: RiskPosition, asOf: Date = new Date()): DataStatus {
  if (position.dataStatus === "FAIL") return "FAIL";
  if (!position.source || position.markPrice === null || position.contractMultiplier === null) return "MISSING";
  if ([position.unitDelta, position.unitGamma, position.unitTheta, position.unitVega].some(value => value === null)) return "MISSING";
  const age = quoteAgeSeconds(position, asOf);
  if (age === null) return position.dataStatus === "WARN" ? "WARN" : "MISSING";
  if (age > 900) return "STALE";
  if (position.contractAdjusted || position.deliverableSource?.includes("fallback")) return "WARN";
  return position.dataStatus === "WARN" ? "WARN" : "LIVE";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function riskOunces(position: RiskPosition): number | null {
  return position.underlying === "GLD" ? position.gldOzPerShare : position.underlyingOzPerUnit;
}

export function deriveTotals(position: RiskPosition): RiskPosition {
  if (position.positionKind === "listed") return {
    ...position,
    totalDeltaXAU: null,
    totalGammaXAU: null,
    totalThetaUSD: null,
    totalVegaUSD: null,
    MV: null,
    UPL: null,
  };
  const multiplier = finiteOrNull(position.contractMultiplier);
  const ounces = finiteOrNull(riskOunces(position));
  const mark = finiteOrNull(position.markPrice);
  const qty = finiteOrNull(position.netQty);
  const entryCost = finiteOrNull(position.entryCost);
  const canScale = multiplier !== null && ounces !== null && qty !== null;
  const marketValue = mark !== null && multiplier !== null && qty !== null ? mark * qty * multiplier : null;
  const totalDelta = canScale && position.unitDelta !== null
    ? position.unitDelta * qty * multiplier * ounces
    : null;
  const totalGamma = canScale && position.unitGamma !== null
    ? position.unitGamma * qty * multiplier * ounces ** 2
    : null;
  const totalTheta = multiplier !== null && qty !== null && position.unitTheta !== null
    ? position.unitTheta * qty * multiplier
    : null;
  const totalVega = multiplier !== null && qty !== null && position.unitVega !== null
    ? position.unitVega * qty * multiplier
    : null;
  return {
    ...position,
    totalDeltaXAU: totalDelta,
    totalGammaXAU: totalGamma,
    totalThetaUSD: totalTheta,
    totalVegaUSD: totalVega,
    MV: marketValue,
    UPL: marketValue !== null && entryCost !== null ? marketValue - entryCost : null,
  };
}

function rollFactors(position: RiskPosition, spot: number, context: { portfolioAbsDelta: number; portfolioAbsMV: number }, asOf: Date): RollPriority {
  const dte = daysToExpiry(position.expiry, asOf);
  const distance = spot > 0 ? (spot - position.strike) / spot : null;
  const mv = Math.abs(position.MV ?? 0);
  const thetaRatio = position.totalThetaUSD === null ? null : Math.abs(position.totalThetaUSD) / Math.max(mv, 1);
  const spread = position.bid !== null && position.ask !== null && position.markPrice && position.markPrice > 0
    ? Math.max(0, position.ask - position.bid) / position.markPrice
    : null;
  const intrinsic = spot > 0
    ? Math.max(position.callPut === "call" ? spot - position.strike : position.strike - spot, 0)
    : null;
  const timeValueRatio = position.markPrice !== null && position.markPrice > 0 && intrinsic !== null
    ? clamp01(Math.max(position.markPrice - intrinsic, 0) / position.markPrice)
    : null;
  const absDelta = Math.abs(position.totalDeltaXAU ?? 0);
  const deltaScore = Math.max(Math.abs(position.unitDelta ?? 0), clamp01(absDelta / 100));
  const residualScale = context.portfolioAbsMV > 0 && spot > 0
    ? clamp01((absDelta * spot * 0.1) / context.portfolioAbsMV / 0.2)
    : 0;
  const factorInputs = [
    { key: "dte", label: "DTE", weight: 0.20, value: Number.isFinite(dte) ? clamp01(1 - Math.max(dte, 0) / 45) : null, reason: Number.isFinite(dte) ? `${dte} DTE` : "expiry missing" },
    { key: "thetaMv", label: "Theta / MV", weight: 0.15, value: thetaRatio === null ? null : clamp01(thetaRatio / 0.05), reason: thetaRatio === null ? "theta or MV missing" : `${(thetaRatio * 100).toFixed(2)}% / day` },
    { key: "distance", label: "Distance to strike", weight: 0.15, value: distance === null ? null : clamp01(1 - Math.abs(distance) / 0.15), reason: distance === null ? "spot missing" : `${(distance * 100).toFixed(2)}% from strike` },
    { key: "delta", label: "Unit / Total Delta", weight: 0.10, value: position.unitDelta === null && position.totalDeltaXAU === null ? null : clamp01(deltaScore), reason: position.totalDeltaXAU === null ? "delta missing" : `${formatCompact(position.totalDeltaXAU)} XAU delta` },
    { key: "spread", label: "Liquidity spread", weight: 0.10, value: spread === null ? null : clamp01(spread / 0.20), reason: spread === null ? "bid/ask missing" : `${(spread * 100).toFixed(2)}% spread` },
    { key: "timeValue", label: "Remaining time value", weight: 0.10, value: timeValueRatio === null ? null : 1 - timeValueRatio, reason: timeValueRatio === null ? "time value missing" : `${(timeValueRatio * 100).toFixed(1)}% time value` },
    { key: "hedge", label: "Hedge contribution", weight: 0.10, value: context.portfolioAbsDelta > 0 ? clamp01(absDelta / context.portfolioAbsDelta / 0.25) : 0, reason: `${formatCompact(absDelta)} / ${formatCompact(context.portfolioAbsDelta)} abs XAU delta` },
    { key: "residual", label: "Van residual improvement", weight: 0.10, value: residualScale, reason: `${(residualScale * 100).toFixed(0)}% residual-improvement proxy` },
  ];
  const factors = factorInputs.map(input => {
    const score = input.value === null ? 0 : input.value * 100;
    return {
      key: input.key,
      label: input.label,
      weight: input.weight,
      score,
      contribution: score * input.weight,
      reason: input.value === null ? `MISSING · ${input.reason}` : input.reason,
    };
  });
  return { total: factors.reduce((sum, factor) => sum + factor.contribution, 0), factors };
}

function editableFormula(
  name: string,
  variables: Record<string, number>,
  formulas: readonly FormulaLike[],
  fallback: number,
): number | null {
  try {
    const value = evaluateNamedFormula(name, variables, formulas, new Set());
    return Number.isFinite(value) ? value : null;
  } catch {
    return Number.isFinite(fallback) ? fallback : null;
  }
}

export function enrichRiskPositions(
  positions: RiskPosition[],
  spots: Record<RiskUnderlying, number>,
  asOf: Date = new Date(),
  customFormulas: readonly FormulaLike[] = DEFAULT_FORMULAS,
): EnrichedRiskPosition[] {
  const formulas = customFormulas.length ? customFormulas : DEFAULT_FORMULAS;
  const totaled = positions.map(deriveTotals);
  const context = {
    portfolioAbsDelta: totaled.reduce((sum, position) => sum + Math.abs(position.totalDeltaXAU ?? 0), 0),
    portfolioAbsMV: totaled.reduce((sum, position) => sum + Math.abs(position.MV ?? 0), 0),
  };
  return totaled.map(position => {
    const spot = spots[position.underlying] || 0;
    const dte = daysToExpiry(position.expiry, asOf);
    const intrinsicValue = spot > 0
      ? Math.max(position.callPut === "call" ? spot - position.strike : position.strike - spot, 0)
      : null;
    const spreadPct = position.bid !== null && position.ask !== null && position.markPrice && position.markPrice > 0
      ? Math.max(0, position.ask - position.bid) / position.markPrice
      : null;
    const multiplier = finiteOrNull(position.contractMultiplier);
    const bidPrice = finiteOrNull(position.bid);
    const askPrice = finiteOrNull(position.ask);
    const bidSize = finiteOrNull(position.bidSize);
    const askSize = finiteOrNull(position.askSize);
    const bidDollarNotional = multiplier !== null && bidPrice !== null && bidSize !== null
      ? editableFormula("bid_dollar_notional", { bidPrice, bidSize, contractMultiplier: multiplier }, formulas, bidPrice * bidSize * multiplier)
      : null;
    const askDollarNotional = multiplier !== null && askPrice !== null && askSize !== null
      ? editableFormula("ask_dollar_notional", { askPrice, askSize, contractMultiplier: multiplier }, formulas, askPrice * askSize * multiplier)
      : null;
    const bidAskDollarNotional = bidDollarNotional !== null && askDollarNotional !== null
      ? editableFormula("bid_ask_dollar_notional", { bidDollarNotional, askDollarNotional }, formulas, bidDollarNotional + askDollarNotional)
      : null;
    const enrichedBase: RiskPosition = { ...position, dataStatus: deriveDataStatus(position, asOf) };
    return {
      ...enrichedBase,
      dte,
      notionalSizeUSD: position.positionKind === "listed"
        ? 0
        : finiteOrNull(position.notionalSizeUSD) ?? (spot > 0 && position.contractMultiplier !== null
          ? position.netQty * position.contractMultiplier * spot
          : null),
      bidDollarNotional,
      askDollarNotional,
      bidAskDollarNotional,
      distanceToStrike: spot > 0 ? (spot - position.strike) / spot : null,
      spreadPct,
      intrinsicValue,
      timeValue: position.markPrice !== null && intrinsicValue !== null ? Math.max(position.markPrice - intrinsicValue, 0) : null,
      quoteAgeSeconds: quoteAgeSeconds(position, asOf),
      rollPriority: rollFactors(enrichedBase, spot, context, asOf),
    };
  });
}

export function buildHeatScale(
  values: Array<number | null>,
  mode: ColorScaleMode,
  centered: boolean,
  rangeOverride?: { min: number; max: number; basis?: "custom" | "held" } | null,
): HeatScale {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const customMin = finiteOrNull(rangeOverride?.min);
  const customMax = finiteOrNull(rangeOverride?.max);
  if (customMin !== null && customMax !== null && customMax >= customMin) {
    const spread = customMax - customMin;
    const normalize = (input: number) => !Number.isFinite(input)
      ? 0
      : spread === 0
        ? 0.5
        : Math.max(0, Math.min(1, (input - customMin) / spread));
    const boundaries = Array.from({ length: 7 }, (_, index) => customMin + spread * index / 6);
    const rangeBasis = rangeOverride?.basis ?? "custom";
    return {
      mode,
      centered: false,
      rangeBasis,
      custom: rangeBasis === "custom",
      clipLow: customMin,
      clipHigh: customMax,
      p99Abs: Math.max(Math.abs(customMin), Math.abs(customMax)),
      bins: boundaries.slice(0, -1).map((from, index) => {
        const to = boundaries[index + 1];
        return { from, to, label: `${formatCompact(from)}…${formatCompact(to)}`, normalized: normalize((from + to) / 2) };
      }),
      normalize,
    };
  }
  if (valid.length === 0) {
    return { mode, centered, rangeBasis: "distribution", custom: false, clipLow: 0, clipHigh: 0, p99Abs: 0, bins: [], normalize: () => 0 };
  }
  const clipLow = percentile(valid, 0.01);
  const clipHigh = percentile(valid, 0.99);
  const p99Abs = Math.max(percentile(valid.map(Math.abs), 0.99), Number.EPSILON);
  const nonZeroAbs = valid.map(Math.abs).filter(value => value > 0);
  const logScale = Math.max(percentile(nonZeroAbs, 0.5), Number.EPSILON);
  const quantiles = [0.01, 0.20, 0.40, 0.60, 0.80, 0.95, 0.99].map(p => percentile(valid, p));

  const normalize = (input: number): number => {
    if (!Number.isFinite(input)) return 0;
    if (mode === "symmetric") return Math.max(-1, Math.min(1, input / p99Abs));
    if (mode === "log") {
      const magnitude = Math.log1p(Math.abs(input) / logScale) / Math.log1p(p99Abs / logScale);
      if (centered) return Math.sign(input) * Math.min(1, magnitude);
      return Math.min(1, magnitude);
    }
    const clipped = Math.max(clipLow, Math.min(clipHigh, input));
    if (clipped <= clipLow) return centered ? -1 : 0;
    if (clipped >= clipHigh) return 1;
    let bin = 0;
    while (bin < quantiles.length - 1 && clipped > quantiles[bin + 1]) bin += 1;
    const ratio = quantiles.length === 1 ? 0.5 : bin / (quantiles.length - 1);
    return centered ? ratio * 2 - 1 : ratio;
  };

  const boundaries = mode === "symmetric"
    ? [-p99Abs, -p99Abs * 0.66, -p99Abs * 0.33, 0, p99Abs * 0.33, p99Abs * 0.66, p99Abs]
    : mode === "log"
      ? centered
        ? [-p99Abs, -p99Abs * 0.1, -p99Abs * 0.01, 0, p99Abs * 0.01, p99Abs * 0.1, p99Abs]
        : [0, p99Abs * 0.001, p99Abs * 0.01, p99Abs * 0.05, p99Abs * 0.2, p99Abs * 0.5, p99Abs]
      : quantiles;
  const bins = boundaries.slice(0, -1).map((from, index) => {
    const to = boundaries[index + 1];
    const midpoint = (from + to) / 2;
    return { from, to, label: `${formatCompact(from)}…${formatCompact(to)}`, normalized: normalize(midpoint) };
  });
  return { mode, centered, rangeBasis: "distribution", custom: false, clipLow, clipHigh, p99Abs, bins, normalize };
}

export function formatCompact(value: number | null, metric?: HeatmapMetric): string {
  if (value === null || !Number.isFinite(value)) return "MISSING";
  if (metric === "unitDelta") {
    const sign = value < 0 ? "−" : value > 0 ? "+" : "";
    return `${sign}${Math.abs(value).toFixed(3)}`;
  }
  if (metric === "markIV" || metric === "bidIV" || metric === "askIV" || metric === "ivSpread") return `${(value * 100).toFixed(2)}%`;
  if (metric === "distanceToStrike") return `${(value * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%`;
  if (metric === "DTE") return `${Math.round(value)}d`;
  if (metric === "rollPriority") return `${value.toFixed(0)}`;
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(1)}k`;
  if (absolute >= 100) return `${sign}${absolute.toFixed(0)}`;
  if (absolute >= 10) return `${sign}${absolute.toFixed(1)}`;
  return `${sign}${absolute.toFixed(2)}`;
}

export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "MISSING";
  return value.toLocaleString("en-US", { maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 });
}

export function formatSpotPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "MISSING";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function heatColor(normalized: number, centered: boolean): string {
  return magnitudeHeatColor(centered ? (Math.max(-1, Math.min(1, normalized)) + 1) / 2 : normalized);
}

/** Comparable traffic-light palette: low = green, midpoint = yellow, high = red. */
export function magnitudeHeatColor(normalized: number): string {
  const value = Math.min(1, Math.max(0, normalized));
  const stops = [
    [0, 22, 163, 74],
    [0.5, 250, 204, 21],
    [1, 239, 68, 68],
  ] as const;
  const upperIndex = stops.findIndex(stop => stop[0] >= value);
  const upper = stops[upperIndex < 0 ? stops.length - 1 : upperIndex];
  const lower = stops[Math.max(0, (upperIndex < 0 ? stops.length - 1 : upperIndex) - 1)];
  const ratio = upper[0] === lower[0] ? 0 : (value - lower[0]) / (upper[0] - lower[0]);
  const channel = (from: number, to: number) => Math.round(from + (to - from) * ratio);
  return `rgb(${channel(lower[1], upper[1])} ${channel(lower[2], upper[2])} ${channel(lower[3], upper[3])} / 0.96)`;
}

export function exerciseControl(position: EnrichedRiskPosition, spot: number): ExerciseControl {
  const multiplier = position.contractMultiplier;
  const funding = multiplier !== null ? position.strike * multiplier * Math.abs(position.netQty) : null;
  const available = position.buyingPower ?? position.availableUSD ?? null;
  const coverage = funding !== null && funding > 0 && available !== null ? available / funding * 100 : null;
  const likelyITM = spot > 0
    ? position.callPut === "call" ? spot >= position.strike : spot <= position.strike
    : null;
  const status: DataStatus = likelyITM && coverage !== null && coverage < 100
    ? "FAIL"
    : funding === null || available === null || !position.brokerCutoff
      ? "MISSING"
      : position.dte <= 2 ? "WARN" : "LIVE";
  const plannedAction = position.plannedAction
    ?? (position.dte < 0 ? "CLOSE" : likelyITM && coverage !== null && coverage >= 100 ? "EXERCISE ALLOWED" : likelyITM ? "ROLL" : "DNE");
  return {
    positionId: position.id,
    label: positionLabel(position),
    dte: position.dte,
    spotDistancePct: spot > 0 ? (spot - position.strike) / spot * 100 : null,
    estimatedFundingUSD: funding,
    availableFundingUSD: available,
    fundingCoveragePct: coverage,
    likelyITM,
    brokerCutoff: position.brokerCutoff ?? null,
    plannedAction,
    owner: position.owner ?? null,
    reviewer: position.reviewer ?? null,
    confirmationId: position.confirmationId ?? null,
    status,
  };
}

export function calculateScenario(positions: EnrichedRiskPosition[], input: ScenarioInput): ScenarioResult {
  const shockFactor = 1 + input.xauShockPct / 100;
  let gldPnlUSD = 0;
  let xautPnlUSD = 0;
  let btcPnlUSD = 0;
  let stressedDeltaXAU = 0;
  let missingCount = 0;
  for (const position of positions) {
    const spot = input.spots[position.underlying];
    const multiplier = position.contractMultiplier;
    const ounces = riskOunces(position);
    if (!spot || multiplier === null || ounces === null || position.markPrice === null || position.markIV === null) {
      missingCount += 1;
      continue;
    }
    const shockedSpot = spot * shockFactor;
    const remainingDays = Math.max(0, position.dte - input.day);
    const sigma = Math.max(0.0001, position.markIV + input.ivShockPoints / 100);
    const theoretical = remainingDays <= 0
      ? {
          price: Math.max(position.callPut === "call" ? shockedSpot - position.strike : position.strike - shockedSpot, 0),
          delta: position.callPut === "call" ? (shockedSpot > position.strike ? 1 : 0) : (shockedSpot < position.strike ? -1 : 0),
        }
      : blackScholes({
          S: shockedSpot,
          K: position.strike,
          T: Math.max(remainingDays / 365, 1 / 365 / 24),
          r: 0.045,
          sigma,
          type: position.callPut,
        });
    const pnl = (theoretical.price - position.markPrice) * position.netQty * multiplier;
    if (position.underlying === "GLD") gldPnlUSD += pnl;
    else if (position.underlying === "XAUT") xautPnlUSD += pnl;
    else btcPnlUSD += pnl;
    stressedDeltaXAU += theoretical.delta * position.netQty * multiplier * ounces;
  }
  const optionPnlUSD = gldPnlUSD + xautPnlUSD + btcPnlUSD;
  const vanNakedPnlUSD = input.vanNakedDeltaXau * input.spots.XAU * input.xauShockPct / 100;
  const residualPnlUSD = optionPnlUSD + vanNakedPnlUSD;
  const stressCoveragePct = vanNakedPnlUSD < 0 && optionPnlUSD > 0
    ? optionPnlUSD / Math.abs(vanNakedPnlUSD) * 100
    : null;
  return { optionPnlUSD, gldPnlUSD, xautPnlUSD, btcPnlUSD, vanNakedPnlUSD, residualPnlUSD, stressedDeltaXAU, stressCoveragePct, missingCount };
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function isoDateOffset(asOf: Date, days: number): string {
  const date = new Date(asOf.getTime() + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function makeInstrument(underlying: RiskUnderlying, expiry: string, strike: number, callPut: CallPut): string {
  return `${underlying}-${expiry.replaceAll("-", "")}-${strike}-${callPut === "call" ? "C" : "P"}`;
}

export function generateMockPositions(count: 100 | 200, seed = 20260811, asOf: Date = new Date()): RiskPosition[] {
  const random = mulberry32(seed + count);
  const expiryOffsets = [-1, 0, 1, 2, 5, 14, 30, 60, 120];
  const brokers = ["IBKR", "KGI", "Futu"];
  const accounts = ["HEDGE-A", "HEDGE-B", "TAIL-RISK"];
  const positions: RiskPosition[] = [];

  for (let index = 0; index < count; index += 1) {
    const underlying: RiskUnderlying = index % 2 === 0 ? "GLD" : "XAUT";
    const spot = underlying === "GLD" ? 247.3 : 3358;
    const strikeStep = underlying === "GLD" ? 5 : 100;
    const strikeIndex = Math.floor(random() * 17) - 8;
    const strike = Math.round((spot + strikeIndex * strikeStep) / strikeStep) * strikeStep;
    const callPut: CallPut = random() > 0.5 ? "call" : "put";
    const expiryOffset = expiryOffsets[index % expiryOffsets.length];
    const expiry = isoDateOffset(asOf, expiryOffset);
    const dte = Math.max(expiryOffset, 0);
    const markIV = (underlying === "GLD" ? 0.18 : 0.42) + random() * (underlying === "GLD" ? 0.18 : 0.35);
    const theoretical = dte === 0
      ? {
          price: Math.max(callPut === "call" ? spot - strike : strike - spot, 0) + Math.max(0.05, spot * 0.002),
          delta: callPut === "call" ? (spot >= strike ? 0.8 : 0.2) : (spot <= strike ? -0.8 : -0.2),
          gamma: 0.01,
          theta: -0.08,
          vega: 0.04,
        }
      : blackScholes({ S: spot, K: strike, T: Math.max(dte / 365, 1 / 365), r: 0.045, sigma: markIV, type: callPut });
    const adjusted = index === 4 || index % 83 === 0;
    const multiplier = underlying === "GLD" ? adjusted ? 150 : 100 : 1;
    const ounces = underlying === "GLD" ? 0.0934 : 1;
    const netQty = (random() > 0.22 ? 1 : -1) * (1 + Math.floor(random() * (underlying === "GLD" ? 25 : 80)));
    const spreadPct = 0.01 + random() * 0.12;
    const markPrice = Math.max(theoretical.price, underlying === "GLD" ? 0.03 : 1);
    const bid = Math.max(0.001, markPrice * (1 - spreadPct / 2));
    const ask = markPrice * (1 + spreadPct / 2);
    const entryPrice = markPrice * (0.72 + random() * 0.56);
    const quoteMinutesAgo = index % 29 === 0 ? 38 : index % 17 === 0 ? 7 : random() * 1.5;
    const missing = index % 37 === 0;
    const fail = index % 71 === 0 && index !== 0;
    const source = missing ? null : underlying === "GLD" ? "MarketData.app / OPRA mock" : "Bybit V5 mock";
    const dataStatus: DataStatus = fail ? "FAIL" : missing ? "MISSING" : quoteMinutesAgo > 15 ? "STALE" : adjusted ? "WARN" : "LIVE";
    const available = 120_000 + Math.floor(random() * 500_000);
    const base: RiskPosition = {
      id: `mock-${count}-${index + 1}`,
      venue: underlying === "GLD" ? "OPRA" : "Bybit",
      broker: underlying === "GLD" ? brokers[index % brokers.length] : "SignalPlus",
      account: accounts[index % accounts.length],
      underlying,
      instrument: makeInstrument(underlying, expiry, strike, callPut),
      callPut,
      expiry,
      strike,
      netQty,
      contractMultiplier: fail ? null : multiplier,
      deliverableSource: fail ? null : adjusted ? "contract-master adjusted mock" : "contract-master live mock",
      contractAdjusted: adjusted,
      gldOzPerShare: underlying === "GLD" ? ounces : null,
      underlyingOzPerUnit: underlying === "XAUT" ? ounces : null,
      markPrice: fail ? null : markPrice,
      bid: missing ? null : bid,
      ask: missing ? null : ask,
      bidSize: missing ? null : 1 + (index * 7) % 40,
      askSize: missing ? null : 1 + (index * 11) % 40,
      markIV: missing ? null : markIV,
      bidIV: missing ? null : Math.max(0.01, markIV - 0.012),
      askIV: missing ? null : markIV + 0.014,
      ivSpread: missing ? null : 0.026,
      unitDelta: missing ? null : Math.max(-0.75, Math.min(0.75, theoretical.delta)),
      unitGamma: missing ? null : theoretical.gamma,
      unitTheta: missing ? null : theoretical.theta,
      unitVega: missing ? null : theoretical.vega,
      totalDeltaXAU: null,
      totalGammaXAU: null,
      totalThetaUSD: null,
      totalVegaUSD: null,
      MV: null,
      entryPrice: fail ? null : entryPrice,
      entryCost: fail ? null : entryPrice * netQty * multiplier + Math.abs(netQty) * 0.65,
      UPL: null,
      quoteTime: missing ? null : new Date(asOf.getTime() - quoteMinutesAgo * 60_000).toISOString(),
      positionTime: new Date(asOf.getTime() - (1 + random() * 60) * DAY_MS).toISOString(),
      source,
      dataStatus,
      availableUSD: available,
      buyingPower: available * (0.8 + random() * 0.5),
      officialClose: underlying === "GLD" ? spot - 0.4 : null,
      brokerCutoff: underlying === "GLD" ? `${expiry} 15:30 ET` : `${expiry} 08:00 UTC`,
      plannedAction: expiryOffset <= 2 ? random() > 0.5 ? "ROLL" : "CLOSE" : "HOLD",
      owner: index % 11 === 0 ? null : ["JY", "AL", "MK"][index % 3],
      reviewer: index % 13 === 0 ? null : ["RW", "SK"][index % 2],
      confirmationId: index % 9 === 0 ? null : `CF-${seed}-${index + 1}`,
    };
    positions.push(deriveTotals(base));
  }

  const explicit = positions
    .filter(position => position.underlying === "GLD" && position.dataStatus !== "MISSING" && position.dataStatus !== "FAIL")
    .slice(0, 2);
  if (explicit.length === 2) {
    explicit[0].id = "mock-unit-small-total-large";
    explicit[0].netQty = 1_000;
    explicit[0].unitDelta = 0.05;
    Object.assign(explicit[0], deriveTotals(explicit[0]));
    explicit[1].id = "mock-unit-large-total-small";
    explicit[1].netQty = 1;
    explicit[1].unitDelta = 0.8;
    Object.assign(explicit[1], deriveTotals(explicit[1]));
  }
  return positions;
}
