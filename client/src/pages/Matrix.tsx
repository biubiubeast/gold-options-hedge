import { DecisionCards, type DecisionCardModel } from "@/components/risk-heatmap/DecisionCards";
import { ExpiryPanel, ScenarioStrip } from "@/components/risk-heatmap/ExpiryScenario";
import { HeatmapGrid, type CellLabelMode, type HeatmapCellModel, type HoverDataPreset } from "@/components/risk-heatmap/HeatmapGrid";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { DEFAULT_VIEWER_HEATMAP_HELD_CELL_CONTENT, getPositionMarketData, type MarketSnapshot, type PortfolioPosition, type PortfolioSettings } from "@/lib/portfolio";
import { buildChainRiskPositions, buildGldChainRiskPositions, buildLiveRiskPositions } from "@/lib/riskHeatmapAdapter";
import { MarketRefreshButton } from "@/components/MarketRefreshButton";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import { useAuth } from "@/_core/hooks/useAuth";
import { resolveHeatmapSpots } from "@/lib/spotSelection";
import { resolveGldContractMultiplier, resolveGldXauMultiplier, resolveXautContractMultiplier, resolveXautXauMultiplier } from "@shared/formulaEngine";
import {
  CENTERED_METRICS,
  HELD_ONLY_HEATMAP_METRICS,
  METRIC_LABELS,
  aggregateHeatmapCellMetric,
  buildHeatScale,
  classifyOptionMoneyness,
  enrichRiskPositions,
  expiryBucketMatchesDte,
  formatCompact,
  formatPrice,
  formatSpotPrice,
  generateMockPositions,
  metricDistribution,
  nearestStrikeLevels,
  percentile,
  positionLabel,
  spotRangeState,
  worstStatus,
  type CallPut,
  type ColorScaleMode,
  type DataStatus,
  type EnrichedRiskPosition,
  type ExpiryBucket,
  type HeatmapMetric,
  type MoneynessFilter,
  type RiskUnderlying,
} from "@shared/riskHeatmap";
import { ArrowLeftRight, ArrowUpDown, Eye, EyeOff, Info, Loader2, LocateFixed, Maximize2, Minimize2, Minus, Plus, ScanLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type DatasetMode = "chain" | "live" | "mock100" | "mock200";
type SelectOption = { value: string; label: string };
type MetricRange = { min: number; max: number };
type ExpirySelection = { expiry: string; positions: EnrichedRiskPosition[] };

const RANGE_STORAGE_KEY = "heatmap-metric-custom-ranges-v1";
const RISK_UNDERLYINGS: RiskUnderlying[] = ["GLD", "XAUT", "BTC"];
const percentageMetrics = new Set<HeatmapMetric>(["markIV", "bidIV", "askIV", "ivSpread", "distanceToStrike"]);

const statusSeverity: Record<DataStatus, number> = { LIVE: 0, WARN: 1, STALE: 2, MISSING: 3, FAIL: 4 };

function initialDataset(): DatasetMode {
  const requested = new URLSearchParams(window.location.search).get("mock");
  return requested === "200" ? "mock200" : requested === "100" ? "mock100" : "chain";
}

function formatHongKongAsOf(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "MISSING · HKT (UTC+8)";
  return `${date.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Hong_Kong" })} HKT (UTC+8)`;
}

function NativeSelect({ label, value, options, onChange, className = "" }: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`grid min-w-0 grid-cols-[auto_1fr] items-center gap-1 text-[9px] text-muted-foreground ${className}`}>
      <span className="whitespace-nowrap">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-6 min-w-0 border border-border/70 bg-background px-1 font-mono text-[9px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function cellKey(position: Pick<EnrichedRiskPosition, "expiry" | "strike">) {
  return `${position.expiry}|${position.strike}`;
}

function bestBy(positions: EnrichedRiskPosition[], value: (position: EnrichedRiskPosition) => number | null, absolute = true) {
  return positions.reduce<EnrichedRiskPosition | null>((best, position) => {
    const candidate = value(position);
    if (candidate === null || !Number.isFinite(candidate)) return best;
    if (!best) return position;
    const current = value(best);
    if (current === null) return position;
    return (absolute ? Math.abs(candidate) > Math.abs(current) : candidate > current) ? position : best;
  }, null);
}

function buildDecisionCards(positions: EnrichedRiskPosition[]): DecisionCardModel[] {
  const maxUnit = bestBy(positions, position => position.unitDelta);
  const maxTotal = bestBy(positions, position => position.totalDeltaXAU);
  const maxThetaBurn = positions.reduce<EnrichedRiskPosition | null>((best, position) => {
    if (position.totalThetaUSD === null) return best;
    if (!best || best.totalThetaUSD === null || position.totalThetaUSD < best.totalThetaUSD) return position;
    return best;
  }, null);
  const maxVega = bestBy(positions, position => position.totalVegaUSD);
  const nearest = positions.reduce<EnrichedRiskPosition | null>((best, position) => !best || position.dte < best.dte ? position : best, null);
  const roll = bestBy(positions, position => position.rollPriority.total, false);
  const dataError = positions.reduce<EnrichedRiskPosition | null>((worst, position) => {
    if (!worst) return position;
    const severityDiff = statusSeverity[position.dataStatus] - statusSeverity[worst.dataStatus];
    if (severityDiff > 0) return position;
    if (severityDiff === 0 && (position.quoteAgeSeconds ?? -1) > (worst.quoteAgeSeconds ?? -1)) return position;
    return worst;
  }, null);
  const card = (key: string, label: string, position: EnrichedRiskPosition | null, value: string, detail?: string): DecisionCardModel => ({
    key,
    label,
    value,
    detail: detail ?? (position ? positionLabel(position) : "No valid position"),
    status: position?.dataStatus ?? "MISSING",
    targetCellKey: position ? cellKey(position) : null,
  });
  return [
    card("unit", "Max Unit Delta", maxUnit, formatCompact(maxUnit?.unitDelta ?? null), maxUnit ? positionLabel(maxUnit) : undefined),
    card("total", "Max Total Delta", maxTotal, formatCompact(maxTotal?.totalDeltaXAU ?? null), maxTotal ? positionLabel(maxTotal) : undefined),
    card("theta", "Max Theta Burn", maxThetaBurn, `$${formatCompact(maxThetaBurn?.totalThetaUSD ?? null)}/d`, maxThetaBurn ? positionLabel(maxThetaBurn) : undefined),
    card("vega", "Max Vega", maxVega, `$${formatCompact(maxVega?.totalVegaUSD ?? null)}/v`, maxVega ? positionLabel(maxVega) : undefined),
    card("expiry", "Nearest Expiry", nearest, nearest ? `${nearest.dte} DTE` : "MISSING", nearest ? positionLabel(nearest) : undefined),
    card("roll", "Highest Roll Priority", roll, roll ? `${roll.rollPriority.total.toFixed(0)} / 100` : "MISSING", roll ? positionLabel(roll) : undefined),
    card("data", "Largest Data Error", dataError, dataError ? `${dataError.dataStatus}${dataError.quoteAgeSeconds !== null ? ` ${Math.round(dataError.quoteAgeSeconds / 60)}m` : ""}` : "MISSING", dataError ? `${positionLabel(dataError)} · ${dataError.source ?? "NO SOURCE"}` : undefined),
  ];
}

function PositionDetailDialog({ position, content, onClose }: { position: EnrichedRiskPosition | null; content: PortfolioSettings["heatmapDetailContent"]; onClose: () => void }) {
  if (!position) return null;
  const candidates: Array<[keyof typeof content, string, unknown]> = [
    ["instrument", "Instrument", position.instrument], ["underlyingCallPut", "Underlying / CallPut", `${position.underlying} / ${position.callPut.toUpperCase()}`],
    ["expiryDte", "Expiry / DTE", `${position.expiry} / ${position.dte}d`], ["strike", "Strike", formatPrice(position.strike)],
    ["venueBrokerAccount", "Venue / Broker / Account", `${position.venue} / ${position.broker} / ${position.account}`], ["netQty", "Net Qty", position.netQty],
    ["contractMultiplier", "Contract Multiplier", position.contractMultiplier], ["xauPerUnit", "XAU per unit", position.underlying === "GLD" ? position.gldOzPerShare : position.underlyingOzPerUnit],
    ["markBidAsk", "Mark / Bid / Ask · Size · $ Notional", `${formatPrice(position.markPrice)} / ${formatPrice(position.bid)} / ${formatPrice(position.ask)} · ${formatCompact(position.bidSize)} / ${formatCompact(position.askSize)} · $${formatCompact(position.bidDollarNotional)} / $${formatCompact(position.askDollarNotional)}`], ["markIv", "Mark IV", formatCompact(position.markIV, "markIV")],
    ["bidAskIv", "Bid IV / Ask IV / Spread", `${formatCompact(position.bidIV, "bidIV")} / ${formatCompact(position.askIV, "askIV")} / ${formatCompact(position.ivSpread, "ivSpread")}`],
    ["qtyNotional", "Qty / Notional USD", `${formatCompact(position.netQty)} / $${formatCompact(position.notionalSizeUSD)}`],
    ["unitDelta", "Unit Delta", position.unitDelta], ["totalDelta", "Total Delta XAU", position.totalDeltaXAU],
    ["unitGamma", "Unit Gamma", position.unitGamma], ["totalGamma", "Total Gamma XAU", position.totalGammaXAU],
    ["unitTheta", "Unit Theta", position.unitTheta], ["totalTheta", "Total Theta USD/day", position.totalThetaUSD],
    ["unitVega", "Unit Vega", position.unitVega], ["totalVega", "Total Vega USD/vol", position.totalVegaUSD],
    ["marketValue", "Market Value", position.MV], ["entryPrice", "Entry Price", position.entryPrice], ["entryCost", "Entry Cost", position.entryCost], ["upl", "UPL", position.UPL],
    ["source", "Source", position.source], ["quoteAsOf", "Quote As-of", position.quoteTime], ["dataStatus", "Data Status", position.dataStatus],
    ["deliverableSource", "Deliverable Source", position.deliverableSource], ["adjustedContract", "Adjusted Contract", position.contractAdjusted ? "YES" : "NO"],
  ];
  const fields = candidates.filter(([key]) => content[key]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{positionLabel(position)} · 完整仓位详情</DialogTitle><DialogDescription>按“设置”页面选择的合约、风险、估值与数据质量字段展示。</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-px border border-border/60 bg-border/60 md:grid-cols-4">{fields.map(([, label, value]) => <div key={label} className="min-w-0 bg-background p-2"><p className="text-[9px] uppercase text-muted-foreground">{label}</p><p className="mt-1 break-words font-mono text-xs">{value === null || value === undefined ? "MISSING" : String(value)}</p></div>)}</div>{content.rollPriority && <div className="border border-border/60 p-3"><div className="flex items-center justify-between"><strong className="text-sm">Roll Priority</strong><span className="font-mono text-lg">{position.rollPriority.total.toFixed(0)} / 100</span></div>{position.rollPriority.factors.map(factor => <div key={factor.key} className="mt-2 grid grid-cols-[90px_1fr_auto] gap-2 text-xs"><span>{factor.label}</span><span className="text-muted-foreground">{factor.reason}</span><span className="font-mono">{factor.contribution.toFixed(1)} / {(factor.weight * 100).toFixed(0)}</span></div>)}</div>}</DialogContent></Dialog>;
}

function ExpiryDetailDialog({ selection, metric, content, onClose }: { selection: ExpirySelection | null; metric: HeatmapMetric; content: PortfolioSettings["heatmapExpiryHoverContent"]; onClose: () => void }) {
  if (!selection) return null;
  const { expiry, positions } = selection;
  const held = positions.filter(position => position.positionKind !== "listed");
  const valid = (values: Array<number | null>) => values.filter((value): value is number => value !== null && Number.isFinite(value));
  const sum = (values: Array<number | null>) => {
    const numbers = valid(values);
    return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null;
  };
  const average = (values: Array<number | null>) => {
    const numbers = valid(values);
    return numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null;
  };
  const selectedMetric = metricDistribution(positions, metric);
  const unitDelta = metricDistribution(positions, "unitDelta");
  const latestQuote = positions.map(position => position.quoteTime).filter((value): value is string => Boolean(value)).sort().at(-1)?.slice(0, 19).replace("T", " ") ?? "MISSING";
  const summaryRows: Array<[string, string]> = [];
  summaryRows.push([`${METRIC_LABELS[metric]} · Average`, formatCompact(selectedMetric.average, metric)]);
  if (content.heldListed) summaryRows.push(["Held / Listed", `${held.length} / ${positions.length - held.length}`]);
  summaryRows.push(["DTE", `${positions[0]?.dte ?? "MISSING"}d`]);
  if (content.worstStatus) summaryRows.push(["Worst Status", worstStatus(positions)]);
  if (content.latestQuote) summaryRows.push(["Latest Quote", latestQuote]);
  if (content.staleMissing) summaryRows.push(["Stale / Missing", `${positions.filter(position => position.dataStatus === "STALE").length} / ${positions.filter(position => position.dataStatus === "MISSING" || position.dataStatus === "FAIL").length}`]);
  if (content.averageIv) summaryRows.push(["Avg Mark / Bid / Ask IV", `${formatCompact(average(positions.map(position => position.markIV)), "markIV")} / ${formatCompact(average(positions.map(position => position.bidIV)), "bidIV")} / ${formatCompact(average(positions.map(position => position.askIV)), "askIV")}`]);
  if (content.openInterestVolume) summaryRows.push(["OI / Volume", `${formatCompact(sum(positions.map(position => position.openInterest ?? null)))} / ${formatCompact(sum(positions.map(position => position.volume ?? null)))}`]);
  if (content.netGrossQty) summaryRows.push(["Net / Gross Qty", `${formatCompact(sum(held.map(position => position.netQty)))} / ${formatCompact(sum(held.map(position => Math.abs(position.netQty))))}`]);
  if (content.grossNotional) summaryRows.push(["Gross Notional", `$${formatCompact(sum(held.map(position => position.notionalSizeUSD === null ? null : Math.abs(position.notionalSizeUSD))))}`]);
  if (content.mvEntry) summaryRows.push(["MV / Entry", `$${formatCompact(sum(held.map(position => position.MV)))} / $${formatCompact(sum(held.map(position => position.entryCost)))}`]);
  if (content.upl) summaryRows.push(["UPL", `$${formatCompact(sum(held.map(position => position.UPL)))}`]);
  if (content.maxRoll) summaryRows.push(["Max Roll Priority", formatCompact(held.length ? Math.max(...held.map(position => position.rollPriority.total)) : null, "rollPriority")]);
  const greekRows: Array<[string, string]> = [];
  if (content.totalDelta) {
    greekRows.push(["Unit Delta · Min / Median / Max", `${formatCompact(unitDelta.min)} / ${formatCompact(unitDelta.median)} / ${formatCompact(unitDelta.max)}`]);
    greekRows.push(["Total Delta XAU · Sum", formatCompact(sum(held.map(position => position.totalDeltaXAU)))]);
  }
  if (content.totalGamma) greekRows.push(["Total Gamma XAU · Sum", formatCompact(sum(held.map(position => position.totalGammaXAU)))]);
  if (content.totalTheta) greekRows.push(["Total Theta USD/day · Sum", `$${formatCompact(sum(held.map(position => position.totalThetaUSD)))}`]);
  if (content.totalVega) greekRows.push(["Total Vega USD/vol · Sum", `$${formatCompact(sum(held.map(position => position.totalVegaUSD)))}`]);

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-6xl"><DialogHeader><DialogTitle>EXPIRY {expiry} · 全面数据</DialogTitle><DialogDescription>基于当前热力图筛选与 Metric；Greeks 默认只展示 Delta，可在“设置”中开启 Gamma、Theta、Vega。</DialogDescription></DialogHeader><div className="grid grid-cols-3 gap-px bg-border/60 text-center"><div className="bg-background p-2"><p className="text-[9px] text-muted-foreground">{METRIC_LABELS[metric]} · MIN</p><strong className="font-mono text-sm">{formatCompact(selectedMetric.min, metric)}</strong></div><div className="bg-background p-2"><p className="text-[9px] text-muted-foreground">MEDIAN</p><strong className="font-mono text-sm">{formatCompact(selectedMetric.median, metric)}</strong></div><div className="bg-background p-2"><p className="text-[9px] text-muted-foreground">MAX</p><strong className="font-mono text-sm">{formatCompact(selectedMetric.max, metric)}</strong></div></div><div className="grid shrink-0 gap-2 md:grid-cols-2"><section className="border border-border/60 p-2"><h3 className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Expiry / Market / Position</h3><div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[10px]">{summaryRows.map(([label, value]) => <div key={label} className="contents"><span className="text-muted-foreground">{label}</span><span className="text-right font-mono">{value}</span></div>)}</div></section><section className="border border-border/60 p-2"><h3 className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Greeks / Risk</h3>{greekRows.length ? <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[10px]">{greekRows.map(([label, value]) => <div key={label} className="contents"><span className="text-muted-foreground">{label}</span><span className="text-right font-mono">{value}</span></div>)}</div> : <p className="text-[10px] text-muted-foreground">Greeks 已在设置中隐藏。</p>}</section></div><div className="min-h-0 flex-1 overflow-auto border border-border/60"><table className="w-full border-collapse text-[9px]"><thead className="sticky top-0 z-10 bg-background text-muted-foreground"><tr><th className="p-1 text-left">Instrument</th><th className="p-1 text-right">Strike</th><th className="p-1">C/P</th><th className="p-1">Position</th><th className="p-1 text-right">{METRIC_LABELS[metric]}</th><th className="p-1 text-right">Mark</th><th className="p-1 text-right">Bid / Ask</th><th className="p-1 text-right">Mark IV</th>{content.totalDelta && <><th className="p-1 text-right">Unit Δ</th><th className="p-1 text-right">Total Δ</th></>}{content.totalGamma && <th className="p-1 text-right">Total Γ</th>}{content.totalTheta && <th className="p-1 text-right">Total Θ</th>}{content.totalVega && <th className="p-1 text-right">Total Vega</th>}<th className="p-1">Status</th></tr></thead><tbody>{[...positions].sort((left, right) => left.strike - right.strike || left.callPut.localeCompare(right.callPut)).map(position => <tr key={position.id} className="border-t border-border/40 font-mono"><td className="max-w-44 truncate p-1" title={position.instrument}>{position.instrument}</td><td className="p-1 text-right">{formatPrice(position.strike)}</td><td className="p-1 text-center">{position.callPut === "call" ? "C" : "P"}</td><td className="p-1 text-center">{position.positionKind === "listed" ? "LISTED" : formatCompact(position.netQty)}</td><td className="p-1 text-right font-semibold text-primary">{formatCompact(metric === "DTE" ? position.dte : metric === "rollPriority" ? position.rollPriority.total : metric === "unitDelta" ? position.unitDelta : metric === "totalDelta" ? position.totalDeltaXAU : metric === "gamma" ? position.totalGammaXAU : metric === "theta" ? position.totalThetaUSD : metric === "vega" ? position.totalVegaUSD : metric === "markIV" ? position.markIV : metric === "bidIV" ? position.bidIV : metric === "askIV" ? position.askIV : metric === "ivSpread" ? position.ivSpread : metric === "qty" ? position.netQty : metric === "notionalSize" ? position.notionalSizeUSD : metric === "bidDollarNotional" ? position.bidDollarNotional : metric === "askDollarNotional" ? position.askDollarNotional : metric === "bidAskDollarNotional" ? position.bidAskDollarNotional : metric === "MV" ? position.MV : metric === "UPL" ? position.UPL : position.distanceToStrike, metric)}</td><td className="p-1 text-right">{formatPrice(position.markPrice)}</td><td className="p-1 text-right">{formatPrice(position.bid)} / {formatPrice(position.ask)}</td><td className="p-1 text-right">{formatCompact(position.markIV, "markIV")}</td>{content.totalDelta && <><td className="p-1 text-right">{formatCompact(position.unitDelta)}</td><td className="p-1 text-right">{formatCompact(position.totalDeltaXAU)}</td></>}{content.totalGamma && <td className="p-1 text-right">{formatCompact(position.totalGammaXAU)}</td>}{content.totalTheta && <td className="p-1 text-right">{formatCompact(position.totalThetaUSD)}</td>}{content.totalVega && <td className="p-1 text-right">{formatCompact(position.totalVegaUSD)}</td>}<td className="p-1 text-center">{position.dataStatus}</td></tr>)}</tbody></table></div><p className="text-[9px] text-muted-foreground">Selected Metric: {selectedMetric.validCount} valid · {selectedMetric.missingCount} missing。MISSING 不会静默按 0 处理。</p></DialogContent></Dialog>;
}

export default function Matrix() {
  const { user } = useAuth();
  const { data: positions, isLoading } = trpc.positions.list.useQuery();
  const { data: formulas } = trpc.formulas.list.useQuery();
  const { data: xautTickers } = trpc.market.xautTickers.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: btcTickers } = trpc.market.btcTickers.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: spotPrices } = trpc.market.spotPrices.useQuery(undefined, { refetchInterval: 10_000 });
  const { settings } = usePortfolioSettings();
  const visibleFilters = settings.heatmapVisibleFilters;
  const visibleSections = settings.heatmapVisibleSections;

  const [dataset, setDataset] = useState<DatasetMode>(initialDataset);
  const [underlying, setUnderlying] = useState<"all" | RiskUnderlying>("GLD");
  const [venue, setVenue] = useState("all");
  const [broker, setBroker] = useState("all");
  const [account, setAccount] = useState("all");
  const [callPut, setCallPut] = useState<"combined" | CallPut>("call");
  const [moneyness, setMoneyness] = useState<MoneynessFilter>("all");
  const [expiryBucket, setExpiryBucket] = useState<ExpiryBucket>("all");
  const [status, setStatus] = useState<"all" | DataStatus>("all");
  const [metric, setMetric] = useState<HeatmapMetric>("notionalSize");
  const [scaleMode, setScaleMode] = useState<ColorScaleMode>("quantile");
  const [transpose, setTranspose] = useState(false);
  const [reverseStrikes, setReverseStrikes] = useState(false);
  const [cellSize, setCellSize] = useState(13);
  const [fitAll, setFitAll] = useState(false);
  const [labelMode, setLabelMode] = useState<CellLabelMode>("none");
  const [hoverPreset, setHoverPreset] = useState<HoverDataPreset>("risk");
  const [spotUnderlying, setSpotUnderlying] = useState<RiskUnderlying | "XAU">("GLD");
  const [highlightCellKey, setHighlightCellKey] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<EnrichedRiskPosition | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<ExpirySelection | null>(null);
  const [cardsVisible, setCardsVisible] = useState(false);
  const [dataErrorHelp, setDataErrorHelp] = useState(false);
  const [customRanges, setCustomRanges] = useState<Partial<Record<HeatmapMetric, MetricRange>>>(() => {
    try {
      return JSON.parse(localStorage.getItem(RANGE_STORAGE_KEY) ?? "{}") as Partial<Record<HeatmapMetric, MetricRange>>;
    } catch {
      return {};
    }
  });
  const [rangeMinDraft, setRangeMinDraft] = useState("");
  const [rangeMaxDraft, setRangeMaxDraft] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const isFullscreen = nativeFullscreen || pseudoFullscreen;

  const { data: gldChain, isFetching: chainFetching } = trpc.market.gldOptionChain.useQuery(undefined, {
    enabled: dataset === "chain" && (underlying === "GLD" || underlying === "all"),
    staleTime: 25_000,
    refetchOnWindowFocus: false,
  });
  const { data: xautChain, isFetching: xautChainFetching } = trpc.market.xautOptionChain.useQuery(undefined, {
    enabled: dataset === "chain" && (underlying === "XAUT" || underlying === "all"),
    staleTime: 8_000,
    refetchOnWindowFocus: false,
  });
  const { data: btcChain, isFetching: btcChainFetching } = trpc.market.btcOptionChain.useQuery(undefined, {
    enabled: dataset === "chain" && (underlying === "BTC" || underlying === "all"),
    staleTime: 8_000,
    refetchOnWindowFocus: false,
  });

  const gldExpiries = useMemo(() => [...new Set((positions || []).filter(position => position.underlying === "GLD").map(position => position.expiry))], [positions]);
  const gldContracts = useMemo(() => (positions || [])
    .filter(position => position.underlying === "GLD")
    .slice(0, 100)
    .map(position => ({ expiry: position.expiry, strike: Number(position.strike), optionType: position.optionType })), [positions]);
  const { data: gldQuotes } = trpc.market.gldOptionQuotes.useQuery(
    { expiries: gldExpiries.slice(0, 24), contracts: gldContracts },
    { enabled: dataset === "live" && gldExpiries.length > 0, refetchInterval: 10_000 },
  );
  const activeGldQuotes = dataset === "chain" ? gldChain?.quotes : gldQuotes;

  const liveViews = useMemo(() => (positions || []).map(position => ({
    position: position as PortfolioPosition,
    market: getPositionMarketData({
      position: position as PortfolioPosition,
      xautTickers,
      btcTickers,
      gldQuotes: activeGldQuotes,
      gldSpot: spotPrices?.gld?.price ?? 0,
      formulas,
      settings,
    }) as MarketSnapshot,
  })), [activeGldQuotes, btcTickers, formulas, positions, settings, spotPrices?.gld?.price, xautTickers]);

  const liveSpots = useMemo(() => resolveHeatmapSpots(spotPrices, {
    xaut: dataset === "chain" ? xautChain?.spot : null,
    gld: dataset === "chain" ? gldChain?.spot : null,
    btc: dataset === "chain" ? btcChain?.spot : null,
  }), [btcChain?.spot, dataset, gldChain?.spot, spotPrices, xautChain?.spot]);
  const displaySpots = useMemo(() => dataset === "live" || dataset === "chain"
    ? { GLD: liveSpots.gld, XAUT: liveSpots.xaut, BTC: liveSpots.btc, XAU: liveSpots.xau }
    : { GLD: 247.3, XAUT: 3358, BTC: 95_000, XAU: 3358 }, [dataset, liveSpots]);
  const asOf = useMemo(() => new Date(), [btcTickers, dataset, gldQuotes, positions, spotPrices, xautTickers]);
  const riskPositions = useMemo(() => {
    if (dataset === "mock100") return generateMockPositions(100, 20260811, asOf);
    if (dataset === "mock200") return generateMockPositions(200, 20260811, asOf);
    const held = buildLiveRiskPositions({ views: liveViews, spots: liveSpots, settings, formulas });
    if (dataset !== "chain") return held;
    const heldKeys = new Set(held.map(position => `${position.underlying}|${position.expiry}|${position.strike}|${position.callPut}`));
    const gldOzPerShare = resolveGldXauMultiplier(formulas?.length ? formulas : [], settings.gldSpotScaleOverride ?? 0.092);
    const xautPerUnit = resolveXautXauMultiplier(formulas?.length ? formulas : [], settings.xautSpotScaleOverride ?? 1);
    const btcPerUnit = liveSpots.xau > 0 && liveSpots.btc > 0 ? liveSpots.btc / liveSpots.xau : null;
    const gldContractMultiplier = resolveGldContractMultiplier(formulas?.length ? formulas : [], settings.gldContractMultiplier);
    const xautContractMultiplier = resolveXautContractMultiplier(formulas?.length ? formulas : [], settings.xautContractMultiplier);
    const listed = [
      ...buildGldChainRiskPositions(gldChain?.quotes ?? [], gldOzPerShare, gldContractMultiplier),
      ...buildChainRiskPositions(xautChain?.quotes ?? [], "XAUT", xautPerUnit, xautContractMultiplier),
      ...buildChainRiskPositions(btcChain?.quotes ?? [], "BTC", btcPerUnit),
    ].filter(position => !heldKeys.has(`${position.underlying}|${position.expiry}|${position.strike}|${position.callPut}`));
    return [...held, ...listed];
  }, [asOf, btcChain?.quotes, dataset, formulas, gldChain?.quotes, liveSpots, liveViews, settings, xautChain?.quotes]);
  const enriched = useMemo(() => enrichRiskPositions(riskPositions, displaySpots, asOf, formulas), [asOf, displaySpots, formulas, riskPositions]);

  const filterOptions = useMemo(() => ({
    venue: [...new Set(enriched.map(position => position.venue))].sort().filter(value => !settings.heatmapHiddenDynamicOptions.venue.includes(value)),
    broker: [...new Set(enriched.map(position => position.broker))].sort().filter(value => !settings.heatmapHiddenDynamicOptions.broker.includes(value)),
    account: [...new Set(enriched.map(position => position.account))].sort().filter(value => !settings.heatmapHiddenDynamicOptions.account.includes(value)),
  }), [enriched, settings.heatmapHiddenDynamicOptions]);
  const enabledOptions = settings.heatmapFilterOptions;
  const metricOptions = (Object.entries(METRIC_LABELS) as Array<[HeatmapMetric, string]>).filter(([key]) => enabledOptions.metric[key]);
  useEffect(() => {
    if (underlying === "GLD") setSpotUnderlying("GLD");
    else if (underlying === "XAUT") setSpotUnderlying("XAUT");
    else if (underlying === "BTC") setSpotUnderlying("BTC");
  }, [underlying]);
  useEffect(() => {
    const fallback = <T extends string>(current: T, enabled: Record<string, boolean>, setValue: (value: T) => void) => {
      if (!enabled[current]) setValue(Object.keys(enabled).find(key => enabled[key]) as T);
    };
    if (visibleFilters.dataset) fallback(dataset, enabledOptions.dataset, setDataset);
    if (visibleFilters.underlying) fallback(underlying, enabledOptions.underlying, setUnderlying);
    if (visibleFilters.callPut) fallback(callPut, enabledOptions.callPut, setCallPut);
    if (visibleFilters.moneyness) fallback(moneyness, enabledOptions.moneyness, setMoneyness);
    if (visibleFilters.expiryBucket) fallback(expiryBucket, enabledOptions.expiryBucket, setExpiryBucket);
    if (visibleFilters.status) fallback(status, enabledOptions.status, setStatus);
    if (visibleFilters.metric) fallback(metric, enabledOptions.metric, setMetric);
    if (visibleFilters.scale) fallback(scaleMode, enabledOptions.scale, setScaleMode);
    if (visibleFilters.spot) fallback(spotUnderlying, enabledOptions.spot, setSpotUnderlying);
    if (visibleFilters.label) fallback(labelMode, enabledOptions.label, setLabelMode);
    if (visibleFilters.hover) fallback(hoverPreset, enabledOptions.hover, setHoverPreset);
    if (venue !== "all" && !filterOptions.venue.includes(venue)) setVenue("all");
    if (broker !== "all" && !filterOptions.broker.includes(broker)) setBroker("all");
    if (account !== "all" && !filterOptions.account.includes(account)) setAccount("all");
  }, [account, broker, callPut, dataset, enabledOptions, expiryBucket, filterOptions, hoverPreset, labelMode, metric, moneyness, scaleMode, spotUnderlying, status, underlying, venue, visibleFilters]);
  useEffect(() => {
    if (!visibleFilters.dataset && dataset !== "chain" && !new URLSearchParams(window.location.search).has("mock")) setDataset("chain");
    if (!visibleFilters.underlying && underlying !== "all") setUnderlying("all");
    if (!visibleFilters.venue && venue !== "all") setVenue("all");
    if (!visibleFilters.broker && broker !== "all") setBroker("all");
    if (!visibleFilters.account && account !== "all") setAccount("all");
    if (!visibleFilters.callPut && callPut !== "combined") setCallPut("combined");
    if (!visibleFilters.moneyness && moneyness !== "all") setMoneyness("all");
    if (!visibleFilters.expiryBucket && expiryBucket !== "all") setExpiryBucket("all");
    if (!visibleFilters.status && status !== "all") setStatus("all");
  }, [account, broker, callPut, dataset, expiryBucket, moneyness, status, underlying, venue, visibleFilters]);
  useEffect(() => {
    if (!visibleSections.decisionCards) setCardsVisible(false);
    if (!visibleSections.dataError) setDataErrorHelp(false);
  }, [visibleSections.dataError, visibleSections.decisionCards]);
  useEffect(() => {
    localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(customRanges));
  }, [customRanges]);
  useEffect(() => {
    const saved = customRanges[metric];
    const factor = percentageMetrics.has(metric) ? 100 : 1;
    setRangeMinDraft(saved ? String(saved.min * factor) : "");
    setRangeMaxDraft(saved ? String(saved.max * factor) : "");
    setRangeError("");
  }, [customRanges, metric]);
  useEffect(() => {
    const syncFullscreen = () => {
      const active = document.fullscreenElement !== null;
      setNativeFullscreen(active);
      if (!active) setPseudoFullscreen(false);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => {
    if (!pseudoFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPseudoFullscreen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [pseudoFullscreen]);

  const toggleFullscreen = async () => {
    if (isFullscreen) {
      setPseudoFullscreen(false);
      if (document.fullscreenElement) await document.exitFullscreen();
      return;
    }
    setFitAll(false);
    setPseudoFullscreen(true);
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // CSS fullscreen remains active when the browser blocks the native API.
    }
  };

  const baseFiltered = useMemo(() => enriched.filter(position =>
    (underlying === "all" || position.underlying === underlying)
    && (venue === "all" || position.venue === venue)
    && (broker === "all" || position.broker === broker)
    && (account === "all" || position.account === account)
    && (callPut === "combined" || position.callPut === callPut)
    && expiryBucketMatchesDte(position.dte, expiryBucket)
    && (status === "all" || position.dataStatus === status),
  ), [account, broker, callPut, enriched, expiryBucket, status, underlying, venue]);
  const atmStrikeByUnderlying = useMemo(() => Object.fromEntries(RISK_UNDERLYINGS.map(riskUnderlying => {
    const availableStrikes = baseFiltered
      .filter(position => position.underlying === riskUnderlying)
      .map(position => position.strike);
    return [riskUnderlying, nearestStrikeLevels(availableStrikes, displaySpots[riskUnderlying])[0] ?? null];
  })) as Record<RiskUnderlying, number | null>, [baseFiltered, displaySpots]);
  const filtered = useMemo(() => moneyness === "all" ? baseFiltered : baseFiltered.filter(position =>
    classifyOptionMoneyness(
      position.strike,
      displaySpots[position.underlying],
      position.callPut,
      atmStrikeByUnderlying[position.underlying],
    ) === moneyness.toUpperCase(),
  ), [atmStrikeByUnderlying, baseFiltered, displaySpots, moneyness]);

  const applyCustomRange = () => {
    const factor = percentageMetrics.has(metric) ? 100 : 1;
    const min = Number(rangeMinDraft) / factor;
    const max = Number(rangeMaxDraft) / factor;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      setRangeError("MIN 必须小于 MAX");
      return;
    }
    setCustomRanges(current => ({ ...current, [metric]: { min, max } }));
    setRangeError("");
  };
  const resetCustomRange = () => {
    setCustomRanges(current => {
      const next = { ...current };
      delete next[metric];
      return next;
    });
  };

  const { cells, expiries, strikes } = useMemo(() => {
    const grouped = new Map<string, EnrichedRiskPosition[]>();
    for (const position of filtered) {
      const key = cellKey(position);
      const list = grouped.get(key) ?? [];
      list.push(position);
      grouped.set(key, list);
    }
    const cellModels: HeatmapCellModel[] = [...grouped.entries()].map(([key, cellPositions]) => ({
      key,
      expiry: cellPositions[0].expiry,
      strike: cellPositions[0].strike,
      positions: cellPositions,
      value: aggregateHeatmapCellMetric(cellPositions, metric),
      listed: cellPositions.some(position => position.positionKind === "listed"),
      held: cellPositions.some(position => position.positionKind !== "listed"),
    }));
    return {
      cells: cellModels,
      expiries: [...new Set(filtered.map(position => position.expiry))].sort(),
      strikes: [...new Set(filtered.map(position => position.strike))].sort((a, b) => a - b),
    };
  }, [filtered, metric]);
  const sequentialMagnitude = metric === "unitDelta" || metric === "totalDelta"
    || metric === "markIV" || metric === "bidIV" || metric === "askIV" || metric === "ivSpread"
    || metric === "qty" || metric === "notionalSize" || metric === "bidDollarNotional"
    || metric === "askDollarNotional" || metric === "bidAskDollarNotional";
  const activeCustomRange = customRanges[metric] ?? null;
  const heldOnlyAutoRange = useMemo(() => {
    if (!HELD_ONLY_HEATMAP_METRICS.has(metric) || activeCustomRange) return null;
    const values = cells
      .filter(cell => cell.held && cell.value !== null && Number.isFinite(cell.value))
      .map(cell => Math.abs(cell.value!));
    if (!values.length) return null;
    return { min: Math.min(...values), max: Math.max(...values), basis: "held" as const };
  }, [activeCustomRange, cells, metric]);
  const scale = useMemo(() => buildHeatScale(
    cells.map(cell => cell.value === null ? null : sequentialMagnitude ? Math.abs(cell.value) : cell.value),
    scaleMode,
    !sequentialMagnitude && CENTERED_METRICS.has(metric),
    activeCustomRange ? { ...activeCustomRange, basis: "custom" } : heldOnlyAutoRange,
  ), [activeCustomRange, cells, heldOnlyAutoRange, metric, scaleMode, sequentialMagnitude]);
  const importanceCutoff = useMemo(() => percentile(cells.map(cell => Math.abs(cell.value ?? 0)).filter(value => value > 0), 0.85), [cells]);
  const lowImportanceCutoff = useMemo(() => percentile(cells.flatMap(cell => cell.value === null || !Number.isFinite(cell.value) ? [] : [Math.abs(cell.value)]), 0.15), [cells]);
  const heldFiltered = useMemo(() => filtered.filter(position => position.positionKind !== "listed"), [filtered]);
  const maxDte = useMemo(() => {
    const validDtes = filtered.map(position => position.dte).filter(Number.isFinite);
    return validDtes.length ? Math.max(...validDtes) : null;
  }, [filtered]);
  const cards = useMemo(() => buildDecisionCards(heldFiltered), [heldFiltered]);
  const spot = displaySpots[spotUnderlying];

  useEffect(() => {
    if (!highlightCellKey) return;
    const timeout = window.setTimeout(() => setHighlightCellKey(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [highlightCellKey]);

  const locateCell = (key: string) => {
    setHighlightCellKey(key);
    requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>("[data-cell-key]")].find(element => element.dataset.cellKey === key);
      target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
  };

  const waitingForChain = dataset === "chain" && (
    ((underlying === "GLD" || underlying === "all") && chainFetching && !gldChain)
    || ((underlying === "XAUT" || underlying === "all") && xautChainFetching && !xautChain)
    || ((underlying === "BTC" || underlying === "all") && btcChainFetching && !btcChain)
  );
  const selectedChainCount = dataset !== "chain" ? null
    : underlying === "GLD" ? gldChain?.contractCount ?? null
    : underlying === "XAUT" ? xautChain?.contractCount ?? null
    : underlying === "BTC" ? btcChain?.contractCount ?? null
    : (gldChain?.contractCount ?? 0) + (xautChain?.contractCount ?? 0) + (btcChain?.contractCount ?? 0);
  const selectedChainTimestamp = dataset !== "chain" ? asOf
    : underlying === "GLD" ? gldChain?.timestamp ?? asOf
    : underlying === "XAUT" ? xautChain?.timestamp ?? asOf
    : underlying === "BTC" ? btcChain?.timestamp ?? asOf
    : [gldChain?.timestamp, xautChain?.timestamp, btcChain?.timestamp]
      .map(value => value === undefined ? Number.NaN : new Date(value).getTime())
      .filter(Number.isFinite)
      .reduce((latest, value) => Math.max(latest, value), asOf.getTime());
  const chainCountLabel = settings.heatmapChainContractCountLabel.trim() || "完整期权链合约数（Call + Put，筛选前）";
  if ((isLoading && (dataset === "live" || dataset === "chain")) || waitingForChain) return <div className="flex h-64 flex-col items-center justify-center gap-2"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="text-xs text-muted-foreground">读取 {underlying === "all" ? "GLD + XAUT + BTC" : underlying} 完整期权链…</p></div>;

  return (
    <div className={`matrix-fullscreen-shell flex h-[calc(100vh-5.5rem)] min-h-[560px] flex-col gap-1 overflow-hidden ${isFullscreen ? "matrix-pseudo-fullscreen" : ""}`} data-testid="institutional-risk-heatmap" data-fullscreen={isFullscreen ? "true" : "false"}>
      <div className="flex h-7 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-xs font-semibold tracking-wide text-foreground">市场热力图</h1>
          <span data-testid="heatmap-scope-stats" className="truncate font-mono text-[9px] text-muted-foreground">{heldFiltered.length} held positions · {filtered.length} filtered contracts · {cells.length} cells · {expiries.length} expiries · {strikes.length} strikes · max DTE {maxDte === null ? "MISSING" : `${maxDte}d`}{visibleSections.chainContractCount && selectedChainCount !== null ? ` · ${underlying === "all" ? "ALL" : underlying} ${chainCountLabel}: ${selectedChainCount.toLocaleString("en-US")}` : ""}</span>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
          <span data-testid="heatmap-as-of" className="whitespace-nowrap">As-of {formatHongKongAsOf(selectedChainTimestamp)}</span>
          {visibleSections.dataError && <button type="button" onClick={() => setDataErrorHelp(value => !value)} className="flex items-center gap-1 border border-border px-1.5 py-0.5 hover:text-foreground"><Info className="h-3 w-3" />Largest Data Error</button>}
          {visibleSections.decisionCards && <button type="button" onClick={() => setCardsVisible(value => !value)} className="flex items-center gap-1 border border-border px-1.5 py-0.5 hover:text-foreground">{cardsVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{cardsVisible ? "Hide Cards" : "Show Cards"}</button>}
          {settings.pageMarketRefreshButtons.matrix && <MarketRefreshButton compact />}
          {selectedPosition && <span className="max-w-64 truncate text-foreground">Selected: {positionLabel(selectedPosition)} · Roll {selectedPosition.rollPriority.total.toFixed(0)}</span>}
        </div>
      </div>

      {visibleSections.dataError && dataErrorHelp && <div className="shrink-0 border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[9px] leading-relaxed text-amber-100"><strong>Largest Data Error</strong> 只检查当前筛选中的真实持仓：先按严重度 FAIL &gt; MISSING &gt; STALE &gt; WARN &gt; LIVE 排序；严重度相同时选 Quote Age 最大的一条。它不是盈亏或风险值，而是最需要修复的数据质量问题。缺 Source、Mark、合约乘数或 Greeks 会触发 MISSING；报价超过 15 分钟触发 STALE。</div>}
      {visibleSections.decisionCards && cardsVisible && <DecisionCards cards={cards} onLocate={locateCell} />}

      {Object.values(visibleFilters).some(Boolean) && <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-1 border border-border/60 bg-card/35 px-1 py-0.5">
        {visibleFilters.dataset && <NativeSelect className="min-w-[130px] flex-1" label="DATA" value={dataset} onChange={value => setDataset(value as DatasetMode)} options={[
          { value: "live", label: "LIVE / IMPORTED" },
          { value: "chain", label: "FULL OPTION CHAIN" },
          { value: "mock100", label: "MOCK 100" },
          { value: "mock200", label: "MOCK 200" },
        ].filter(option => enabledOptions.dataset[option.value as DatasetMode])} />}
        {visibleFilters.underlying && <NativeSelect className="w-[165px] flex-none" label="UNDERLYING" value={underlying} onChange={value => setUnderlying(value as typeof underlying)} options={[{ value: "GLD", label: "GLD/USD-OPRA" }, { value: "XAUT", label: "XAUT/USDT - Bybit" }, { value: "BTC", label: "BTC/USDT - Bybit" }, { value: "all", label: "ALL UNDERLYINGS" }].filter(option => enabledOptions.underlying[option.value as keyof typeof enabledOptions.underlying])} />}
        {visibleFilters.venue && <NativeSelect className="min-w-[100px] flex-1" label="VENUE" value={venue} onChange={setVenue} options={[{ value: "all", label: "ALL" }, ...filterOptions.venue.map(value => ({ value, label: value }))]} />}
        {visibleFilters.broker && <NativeSelect className="min-w-[100px] flex-1" label="BROKER" value={broker} onChange={setBroker} options={[{ value: "all", label: "ALL" }, ...filterOptions.broker.map(value => ({ value, label: value }))]} />}
        {visibleFilters.account && <NativeSelect className="min-w-[110px] flex-1" label="ACCOUNT" value={account} onChange={setAccount} options={[{ value: "all", label: "ALL" }, ...filterOptions.account.map(value => ({ value, label: value }))]} />}
        {visibleFilters.callPut && <NativeSelect className="w-[90px] flex-none" label="C/P" value={callPut} onChange={value => setCallPut(value as typeof callPut)} options={[{ value: "call", label: "CALL" }, { value: "put", label: "PUT" }, { value: "combined", label: "COMBINED" }].filter(option => enabledOptions.callPut[option.value as keyof typeof enabledOptions.callPut])} />}
        {visibleFilters.expiryBucket && <NativeSelect className="min-w-[90px] flex-1" label="DTE" value={expiryBucket} onChange={value => setExpiryBucket(value as ExpiryBucket)} options={[{ value: "all", label: "ALL" }, { value: "expired", label: "EXP" }, { value: "0-2", label: "0–2" }, { value: "3-7", label: "3–7" }, { value: "8-30", label: "8–30" }, { value: "31+", label: "31+" }].filter(option => enabledOptions.expiryBucket[option.value as ExpiryBucket])} />}
        {visibleFilters.status && <NativeSelect className="min-w-[100px] flex-1" label="STATUS" value={status} onChange={value => setStatus(value as typeof status)} options={[{ value: "all", label: "ALL" }, ...(["LIVE", "STALE", "WARN", "MISSING", "FAIL"] as DataStatus[]).map(value => ({ value, label: value }))].filter(option => enabledOptions.status[option.value as keyof typeof enabledOptions.status])} />}
        {visibleFilters.metric && <NativeSelect label="METRIC" value={metric} onChange={value => setMetric(value as HeatmapMetric)} options={metricOptions.map(([value, label]) => ({ value, label }))} />}
        {visibleFilters.moneyness && <NativeSelect className="w-[105px] flex-none" label="ITM/OTM" value={moneyness} onChange={value => setMoneyness(value as MoneynessFilter)} options={[{ value: "all", label: "ALL" }, { value: "itm", label: "ITM" }, { value: "otm", label: "OTM" }].filter(option => enabledOptions.moneyness[option.value as MoneynessFilter])} />}
        {visibleFilters.label && <NativeSelect label="LABEL" value={labelMode} onChange={value => setLabelMode(value as CellLabelMode)} options={[{ value: "none", label: "NONE" }, { value: "held", label: "POSITION METRIC" }, { value: "top", label: "TOP 15%" }, { value: "bottom", label: "BOTTOM 15%" }, { value: "all", label: "ALL" }].filter(option => enabledOptions.label[option.value as keyof typeof enabledOptions.label])} />}
        {visibleFilters.hover && <NativeSelect label="HOVER" value={hoverPreset} onChange={value => setHoverPreset(value as HoverDataPreset)} options={[{ value: "risk", label: "RISK" }, { value: "market", label: "MARKET" }, { value: "pnl", label: "PNL" }, { value: "all", label: "ALL" }].filter(option => enabledOptions.hover[option.value as keyof typeof enabledOptions.hover])} />}
      </div>}

      {Object.entries(visibleFilters).some(([key, visible]) => visible && !["dataset", "underlying", "venue", "broker", "account", "callPut", "moneyness", "expiryBucket", "status", "metric", "label", "hover"].includes(key)) && <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-1 border border-border/60 bg-card/35 px-1">
        {visibleFilters.scale && <NativeSelect label="SCALE" value={scaleMode} onChange={value => setScaleMode(value as ColorScaleMode)} options={[{ value: "quantile", label: "QUANTILE" }, { value: "log", label: "LOG" }, { value: "symmetric", label: "ZERO-CENTER" }].filter(option => enabledOptions.scale[option.value as keyof typeof enabledOptions.scale])} />}
        {visibleFilters.spot && <NativeSelect label="SPOT" value={spotUnderlying} onChange={value => setSpotUnderlying(value as typeof spotUnderlying)} options={[{ value: "GLD", label: "GLD" }, { value: "XAUT", label: "XAUT" }, { value: "BTC", label: "BTC" }, { value: "XAU", label: "XAU" }].filter(option => enabledOptions.spot[option.value as keyof typeof enabledOptions.spot])} />}
        {visibleFilters.range && <>
        <label className="flex h-6 items-center gap-1 border border-border/70 px-1 text-[8px] text-muted-foreground"><span>MIN{percentageMetrics.has(metric) ? "%" : ""}</span><input aria-label="Color scale minimum" inputMode="decimal" value={rangeMinDraft} onChange={event => setRangeMinDraft(event.target.value)} placeholder={heldOnlyAutoRange ? formatCompact(heldOnlyAutoRange.min, metric) : "AUTO"} className="h-4 w-14 bg-transparent text-right font-mono text-foreground outline-none" /></label>
        <label className="flex h-6 items-center gap-1 border border-border/70 px-1 text-[8px] text-muted-foreground"><span>MAX{percentageMetrics.has(metric) ? "%" : ""}</span><input aria-label="Color scale maximum" inputMode="decimal" value={rangeMaxDraft} onChange={event => setRangeMaxDraft(event.target.value)} placeholder={heldOnlyAutoRange ? formatCompact(heldOnlyAutoRange.max, metric) : "AUTO"} className="h-4 w-14 bg-transparent text-right font-mono text-foreground outline-none" /></label>
        <button type="button" onClick={applyCustomRange} className="h-6 border border-border px-1.5 text-[8px] text-muted-foreground hover:text-foreground">Apply Range</button>
        {activeCustomRange && <button type="button" onClick={resetCustomRange} className="h-6 border border-emerald-400/60 px-1.5 text-[8px] text-emerald-300">Custom ✓ / Reset</button>}
        {rangeError && <span role="alert" className="text-[8px] text-red-300">{rangeError}</span>}
        </>}
        {visibleFilters.transpose && <button type="button" onClick={() => setTranspose(value => !value)} className={`flex h-6 items-center gap-1 border px-2 text-[9px] ${transpose ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}><ArrowLeftRight className="h-3 w-3" />Transpose</button>}
        {visibleFilters.reverseStrikes && <button type="button" onClick={() => setReverseStrikes(value => !value)} className={`flex h-6 items-center gap-1 border px-2 text-[9px] ${reverseStrikes ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}><ArrowUpDown className="h-3 w-3" />Strike {reverseStrikes ? "↓" : "↑"}</button>}
        {visibleFilters.cellSize && <div className="flex h-6 items-center border border-border text-[9px] text-muted-foreground"><button aria-label="Smaller cells" className="h-full px-1 hover:text-foreground" onClick={() => { setFitAll(false); setCellSize(value => Math.max(3, value - 1)); }}><Minus className="h-3 w-3" /></button><span className="w-8 text-center font-mono">{cellSize}px</span><button aria-label="Larger cells" className="h-full px-1 hover:text-foreground" onClick={() => { setFitAll(false); setCellSize(value => Math.min(28, value + 1)); }}><Plus className="h-3 w-3" /></button></div>}
        {visibleFilters.fitAll && <button type="button" onClick={() => setFitAll(value => !value)} className={`flex h-6 items-center gap-1 border px-2 text-[9px] ${fitAll ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}><ScanLine className="h-3 w-3" />Fit All</button>}
        {visibleFilters.fullscreen && <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit heatmap fullscreen" : "Enter heatmap fullscreen"} className={`flex h-6 items-center gap-1 border px-2 text-[9px] ${isFullscreen ? "border-amber-300 bg-amber-300/15 text-amber-200" : "border-border text-muted-foreground"}`}>{isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</button>}
        <Tooltip delayDuration={80}><TooltipTrigger asChild><span data-testid="spot-atm-marker" className="ml-auto flex min-w-0 items-center justify-end gap-1 truncate font-mono text-[8px] text-amber-300"><LocateFixed className="h-3 w-3" />ATM</span></TooltipTrigger><TooltipContent side="bottom" sideOffset={4} className="border border-amber-300/40 bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-xl"><span className="text-muted-foreground">{spotUnderlying} Spot price </span><strong className="font-mono text-amber-300">{formatSpotPrice(spot)}</strong><span className="ml-2 text-muted-foreground">Nearest Strike </span><strong className="font-mono">{formatPrice(spotRangeState(strikes, spot).nearestStrike)}</strong></TooltipContent></Tooltip>
      </div>}

      {visibleSections.chainStatusBanner && dataset === "chain" && (underlying === "GLD" || underlying === "all") && gldChain && <div className="shrink-0 border border-cyan-400/30 bg-cyan-500/5 px-2 py-0.5 font-mono text-[8px] text-cyan-100">GLD FULL CHAIN · {gldChain.contractCount} contracts · {gldChain.expiryCount} expiries · {gldChain.strikeCount} strikes · {gldChain.source} · updated {new Date(gldChain.timestamp).toLocaleString("zh-CN", { hour12: false })} · observed age {Math.round(gldChain.delaySeconds / 60)}m · Cboe delayed feed (actual lag varies) · cyan listed / white held</div>}
      {visibleSections.chainStatusBanner && dataset === "chain" && (underlying === "XAUT" || underlying === "all") && xautChain && <div className="shrink-0 border border-violet-400/30 bg-violet-500/5 px-2 py-0.5 font-mono text-[8px] text-violet-100">XAUT FULL CHAIN · {xautChain.contractCount} tradable contracts · {xautChain.expiryCount} expiries · {xautChain.strikeCount} strikes · {xautChain.source} · updated {new Date(xautChain.timestamp).toLocaleString("zh-CN", { hour12: false })} · observed age {Math.round(xautChain.delaySeconds)}s</div>}
      {visibleSections.chainStatusBanner && dataset === "chain" && (underlying === "BTC" || underlying === "all") && btcChain && <div className="shrink-0 border border-orange-400/30 bg-orange-500/5 px-2 py-0.5 font-mono text-[8px] text-orange-100">BTC FULL CHAIN · {btcChain.contractCount} tradable contracts · {btcChain.expiryCount} expiries · {btcChain.strikeCount} strikes · {btcChain.source} · updated {new Date(btcChain.timestamp).toLocaleString("zh-CN", { hour12: false })} · observed age {Math.round(btcChain.delaySeconds)}s</div>}
      {visibleSections.positionOnlyMetricBanner && HELD_ONLY_HEATMAP_METRICS.has(metric) && <div className="shrink-0 border border-amber-300/25 bg-amber-300/5 px-2 py-0.5 font-mono text-[8px] text-amber-100">POSITION-ONLY METRIC · only held cells are colored and included in the default min/max · listed contracts remain hoverable but uncolored</div>}
      {filtered.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center border border-dashed border-border text-sm text-muted-foreground">
          <p>当前筛选没有有效 position。</p>
          {dataset === "live" && <button type="button" className="mt-2 border border-primary/50 px-3 py-1 text-xs text-primary" onClick={() => setDataset("mock200")}>打开 MOCK 200 压力数据</button>}
        </div>
      ) : (
        <HeatmapGrid
          cells={cells}
          expiries={expiries}
          strikes={strikes}
          metric={metric}
          scale={scale}
          importanceCutoff={importanceCutoff}
          lowImportanceCutoff={lowImportanceCutoff}
          transpose={transpose}
          reverseStrikes={reverseStrikes}
          cellSize={cellSize}
          fitAll={fitAll}
          spot={spot}
          callPut={callPut}
          moneyness={moneyness}
          atmStrike={underlying === "all" ? undefined : atmStrikeByUnderlying[underlying]}
          highlightCellKey={highlightCellKey}
          labelMode={labelMode}
          hoverPreset={hoverPreset}
          sequentialMagnitude={sequentialMagnitude}
          heldCellContent={user?.role === "admin" ? settings.heatmapHeldCellContent : DEFAULT_VIEWER_HEATMAP_HELD_CELL_CONTENT}
          hoverContent={settings.heatmapHoverContent}
          cellDetailEnabled={settings.heatmapClickActions.cellDetail}
          expiryDetailEnabled={settings.heatmapClickActions.expiryDetail}
          onSelectPosition={setSelectedPosition}
          onSelectExpiry={(expiry, expiryPositions) => setSelectedExpiry({ expiry, positions: expiryPositions })}
        />
      )}

      <ExpiryPanel positions={heldFiltered} gldSpot={displaySpots.GLD} />
      {visibleSections.scenario && <ScenarioStrip positions={heldFiltered} spots={displaySpots} />}
      <PositionDetailDialog position={selectedPosition} content={settings.heatmapDetailContent} onClose={() => setSelectedPosition(null)} />
      <ExpiryDetailDialog selection={selectedExpiry} metric={metric} content={settings.heatmapExpiryHoverContent} onClose={() => setSelectedExpiry(null)} />
    </div>
  );
}
