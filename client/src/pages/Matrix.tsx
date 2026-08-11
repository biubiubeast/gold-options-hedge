import { DecisionCards, type DecisionCardModel } from "@/components/risk-heatmap/DecisionCards";
import { ExpiryPanel, ScenarioStrip } from "@/components/risk-heatmap/ExpiryScenario";
import { HeatmapGrid, type HeatmapCellModel } from "@/components/risk-heatmap/HeatmapGrid";
import { trpc } from "@/lib/trpc";
import { getPositionMarketData, type MarketSnapshot, type PortfolioPosition } from "@/lib/portfolio";
import { buildLiveRiskPositions } from "@/lib/riskHeatmapAdapter";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import {
  CENTERED_METRICS,
  METRIC_LABELS,
  aggregateMetric,
  buildHeatScale,
  enrichRiskPositions,
  formatCompact,
  formatPrice,
  generateMockPositions,
  metricValue,
  percentile,
  positionLabel,
  type CallPut,
  type ColorScaleMode,
  type DataStatus,
  type EnrichedRiskPosition,
  type HeatmapMetric,
  type RiskUnderlying,
} from "@shared/riskHeatmap";
import { ArrowLeftRight, Loader2, LocateFixed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type DatasetMode = "live" | "mock100" | "mock200";
type ExpiryBucket = "all" | "expired" | "0-2" | "3-7" | "8-30" | "31+";
type SelectOption = { value: string; label: string };

const metricOptions = Object.entries(METRIC_LABELS) as Array<[HeatmapMetric, string]>;
const statusSeverity: Record<DataStatus, number> = { LIVE: 0, WARN: 1, STALE: 2, MISSING: 3, FAIL: 4 };

function initialDataset(): DatasetMode {
  const requested = new URLSearchParams(window.location.search).get("mock");
  return requested === "200" ? "mock200" : requested === "100" ? "mock100" : "live";
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
    card("total", "Max Total Delta", maxTotal, `${formatCompact(maxTotal?.totalDeltaXAU ?? null)} oz`, maxTotal ? positionLabel(maxTotal) : undefined),
    card("theta", "Max Theta Burn", maxThetaBurn, `$${formatCompact(maxThetaBurn?.totalThetaUSD ?? null)}/d`, maxThetaBurn ? positionLabel(maxThetaBurn) : undefined),
    card("vega", "Max Vega", maxVega, `$${formatCompact(maxVega?.totalVegaUSD ?? null)}/v`, maxVega ? positionLabel(maxVega) : undefined),
    card("expiry", "Nearest Expiry", nearest, nearest ? `${nearest.dte} DTE` : "MISSING", nearest ? positionLabel(nearest) : undefined),
    card("roll", "Highest Roll Priority", roll, roll ? `${roll.rollPriority.total.toFixed(0)} / 100` : "MISSING", roll ? positionLabel(roll) : undefined),
    card("data", "Largest Data Error", dataError, dataError ? `${dataError.dataStatus}${dataError.quoteAgeSeconds !== null ? ` ${Math.round(dataError.quoteAgeSeconds / 60)}m` : ""}` : "MISSING", dataError ? `${positionLabel(dataError)} · ${dataError.source ?? "NO SOURCE"}` : undefined),
  ];
}

function expiryBucketMatches(position: EnrichedRiskPosition, bucket: ExpiryBucket) {
  if (bucket === "all") return true;
  if (bucket === "expired") return position.dte < 0;
  if (bucket === "0-2") return position.dte >= 0 && position.dte <= 2;
  if (bucket === "3-7") return position.dte >= 3 && position.dte <= 7;
  if (bucket === "8-30") return position.dte >= 8 && position.dte <= 30;
  return position.dte >= 31;
}

export default function Matrix() {
  const { data: positions, isLoading } = trpc.positions.list.useQuery();
  const { data: formulas } = trpc.formulas.list.useQuery();
  const { data: xautTickers } = trpc.market.xautTickers.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: spotPrices } = trpc.market.spotPrices.useQuery(undefined, { refetchInterval: 10_000 });
  const { settings } = usePortfolioSettings();

  const [dataset, setDataset] = useState<DatasetMode>(initialDataset);
  const [underlying, setUnderlying] = useState<"all" | RiskUnderlying>("GLD");
  const [venue, setVenue] = useState("all");
  const [broker, setBroker] = useState("all");
  const [account, setAccount] = useState("all");
  const [callPut, setCallPut] = useState<"combined" | CallPut>("combined");
  const [expiryBucket, setExpiryBucket] = useState<ExpiryBucket>("all");
  const [status, setStatus] = useState<"all" | DataStatus>("all");
  const [metric, setMetric] = useState<HeatmapMetric>("totalDelta");
  const [scaleMode, setScaleMode] = useState<ColorScaleMode>("quantile");
  const [transpose, setTranspose] = useState(false);
  const [spotUnderlying, setSpotUnderlying] = useState<RiskUnderlying | "XAU">("GLD");
  const [highlightCellKey, setHighlightCellKey] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<EnrichedRiskPosition | null>(null);

  const gldExpiries = useMemo(() => [...new Set((positions || []).filter(position => position.underlying === "GLD").map(position => position.expiry))], [positions]);
  const gldContracts = useMemo(() => (positions || [])
    .filter(position => position.underlying === "GLD")
    .slice(0, 100)
    .map(position => ({ expiry: position.expiry, strike: Number(position.strike), optionType: position.optionType })), [positions]);
  const { data: gldQuotes } = trpc.market.gldOptionQuotes.useQuery(
    { expiries: gldExpiries.slice(0, 24), contracts: gldContracts },
    { enabled: dataset === "live" && gldExpiries.length > 0, refetchInterval: 10_000 },
  );

  const liveViews = useMemo(() => (positions || []).map(position => ({
    position: position as PortfolioPosition,
    market: getPositionMarketData({
      position: position as PortfolioPosition,
      xautTickers,
      gldQuotes,
      gldSpot: spotPrices?.gld?.price ?? 0,
      formulas,
      settings,
    }) as MarketSnapshot,
  })), [formulas, gldQuotes, positions, settings, spotPrices?.gld?.price, xautTickers]);

  const liveSpots = useMemo(() => ({
    xaut: spotPrices?.xaut?.price ?? 0,
    gld: spotPrices?.gld?.price ?? 0,
    xau: spotPrices?.gold?.price ?? spotPrices?.xaut?.price ?? 0,
  }), [spotPrices]);
  const displaySpots = useMemo(() => dataset === "live"
    ? { GLD: liveSpots.gld, XAUT: liveSpots.xaut, XAU: liveSpots.xau }
    : { GLD: 247.3, XAUT: 3358, XAU: 3358 }, [dataset, liveSpots]);
  const asOf = useMemo(() => new Date(), [dataset, gldQuotes, positions, spotPrices, xautTickers]);
  const riskPositions = useMemo(() => {
    if (dataset === "mock100") return generateMockPositions(100, 20260811, asOf);
    if (dataset === "mock200") return generateMockPositions(200, 20260811, asOf);
    return buildLiveRiskPositions({ views: liveViews, spots: liveSpots, settings, formulas });
  }, [asOf, dataset, formulas, liveSpots, liveViews, settings]);
  const enriched = useMemo(() => enrichRiskPositions(riskPositions, displaySpots, asOf), [asOf, displaySpots, riskPositions]);

  const filterOptions = useMemo(() => ({
    venue: [...new Set(enriched.map(position => position.venue))].sort(),
    broker: [...new Set(enriched.map(position => position.broker))].sort(),
    account: [...new Set(enriched.map(position => position.account))].sort(),
  }), [enriched]);
  useEffect(() => {
    if (underlying === "GLD") setSpotUnderlying("GLD");
    else if (underlying === "XAUT") setSpotUnderlying("XAUT");
  }, [underlying]);

  const filtered = useMemo(() => enriched.filter(position =>
    (underlying === "all" || position.underlying === underlying)
    && (venue === "all" || position.venue === venue)
    && (broker === "all" || position.broker === broker)
    && (account === "all" || position.account === account)
    && (callPut === "combined" || position.callPut === callPut)
    && expiryBucketMatches(position, expiryBucket)
    && (status === "all" || position.dataStatus === status),
  ), [account, broker, callPut, enriched, expiryBucket, status, underlying, venue]);

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
      value: aggregateMetric(cellPositions, metric),
    }));
    return {
      cells: cellModels,
      expiries: [...new Set(filtered.map(position => position.expiry))].sort(),
      strikes: [...new Set(filtered.map(position => position.strike))].sort((a, b) => a - b),
    };
  }, [filtered, metric]);
  const scale = useMemo(() => buildHeatScale(cells.map(cell => cell.value), scaleMode, CENTERED_METRICS.has(metric)), [cells, metric, scaleMode]);
  const importanceCutoff = useMemo(() => percentile(cells.map(cell => Math.abs(cell.value ?? 0)).filter(value => value > 0), 0.85), [cells]);
  const cards = useMemo(() => buildDecisionCards(filtered), [filtered]);
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

  if (isLoading && dataset === "live") return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex h-[calc(100vh-5.5rem)] min-h-[560px] flex-col gap-1 overflow-hidden" data-testid="institutional-risk-heatmap">
      <div className="flex h-7 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-xs font-semibold tracking-wide text-foreground">GLD + XAUT POSITION RISK HEATMAP</h1>
          <span className="font-mono text-[9px] text-muted-foreground">{filtered.length}/{enriched.length} positions · {cells.length} cells</span>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
          <span>As-of {asOf.toLocaleTimeString("zh-CN", { hour12: false })}</span>
          {selectedPosition && <span className="max-w-64 truncate text-foreground">Selected: {positionLabel(selectedPosition)} · Roll {selectedPosition.rollPriority.total.toFixed(0)}</span>}
        </div>
      </div>

      <DecisionCards cards={cards} onLocate={locateCell} />

      <div className="grid h-7 shrink-0 grid-cols-[1.15fr_repeat(7,minmax(80px,1fr))] items-center gap-1 border border-border/60 bg-card/35 px-1">
        <NativeSelect label="DATA" value={dataset} onChange={value => setDataset(value as DatasetMode)} options={[
          { value: "live", label: "LIVE / IMPORTED" },
          { value: "mock100", label: "MOCK 100" },
          { value: "mock200", label: "MOCK 200" },
        ]} />
        <NativeSelect label="U" value={underlying} onChange={value => setUnderlying(value as typeof underlying)} options={[{ value: "GLD", label: "GLD" }, { value: "XAUT", label: "XAUT" }, { value: "all", label: "ALL" }]} />
        <NativeSelect label="VENUE" value={venue} onChange={setVenue} options={[{ value: "all", label: "ALL" }, ...filterOptions.venue.map(value => ({ value, label: value }))]} />
        <NativeSelect label="BROKER" value={broker} onChange={setBroker} options={[{ value: "all", label: "ALL" }, ...filterOptions.broker.map(value => ({ value, label: value }))]} />
        <NativeSelect label="ACCOUNT" value={account} onChange={setAccount} options={[{ value: "all", label: "ALL" }, ...filterOptions.account.map(value => ({ value, label: value }))]} />
        <NativeSelect label="C/P" value={callPut} onChange={value => setCallPut(value as typeof callPut)} options={[{ value: "combined", label: "COMBINED" }, { value: "call", label: "CALL" }, { value: "put", label: "PUT" }]} />
        <NativeSelect label="DTE" value={expiryBucket} onChange={value => setExpiryBucket(value as ExpiryBucket)} options={[{ value: "all", label: "ALL" }, { value: "expired", label: "EXP" }, { value: "0-2", label: "0–2" }, { value: "3-7", label: "3–7" }, { value: "8-30", label: "8–30" }, { value: "31+", label: "31+" }]} />
        <NativeSelect label="STATUS" value={status} onChange={value => setStatus(value as typeof status)} options={[{ value: "all", label: "ALL" }, ...(["LIVE", "STALE", "WARN", "MISSING", "FAIL"] as DataStatus[]).map(value => ({ value, label: value }))]} />
      </div>

      <div className="grid min-h-8 shrink-0 grid-cols-[170px_128px_104px_auto_1fr] items-center gap-2 border border-border/60 bg-card/35 px-1">
        <NativeSelect label="METRIC" value={metric} onChange={value => setMetric(value as HeatmapMetric)} options={metricOptions.map(([value, label]) => ({ value, label }))} />
        <NativeSelect label="SCALE" value={scaleMode} onChange={value => setScaleMode(value as ColorScaleMode)} options={[{ value: "quantile", label: "QUANTILE" }, { value: "log", label: "LOG" }, { value: "symmetric", label: "ZERO-CENTER" }]} />
        <NativeSelect label="SPOT" value={spotUnderlying} onChange={value => setSpotUnderlying(value as typeof spotUnderlying)} options={[{ value: "GLD", label: "GLD" }, { value: "XAUT", label: "XAUT" }, { value: "XAU", label: "XAU" }]} />
        <button type="button" onClick={() => setTranspose(value => !value)} className={`flex h-6 items-center gap-1 border px-2 text-[9px] ${transpose ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}><ArrowLeftRight className="h-3 w-3" />Transpose</button>
        <div className="flex min-w-0 items-center gap-1 overflow-hidden" aria-label="heatmap legend">
          <span className="shrink-0 text-[8px] text-muted-foreground">P99 CLIP</span>
          {scale.bins.length ? scale.bins.map((bin, index) => (
            <div key={`${bin.from}-${bin.to}-${index}`} className="min-w-0 flex-1" title={bin.label}>
              <div className="h-2 border border-white/5" style={{ backgroundColor: CENTERED_METRICS.has(metric) ? bin.normalized < 0 ? `rgba(224,70,78,${0.18 + Math.abs(bin.normalized) * 0.75})` : `rgba(40,160,205,${0.18 + Math.abs(bin.normalized) * 0.75})` : `rgba(222,164,48,${0.15 + Math.abs(bin.normalized) * 0.8})` }} />
              <span className="block truncate text-center font-mono text-[7px] text-muted-foreground">{formatCompact(bin.from, metric)}…{formatCompact(bin.to, metric)}</span>
            </div>
          )) : <span className="text-[9px] text-muted-foreground">MISSING DATA</span>}
          <span className="flex shrink-0 items-center gap-1 text-[8px] text-muted-foreground"><LocateFixed className="h-3 w-3" />{formatPrice(spot)}</span>
        </div>
      </div>

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
          transpose={transpose}
          spot={spot}
          callPut={callPut}
          highlightCellKey={highlightCellKey}
          onSelectPosition={setSelectedPosition}
        />
      )}

      <ExpiryPanel positions={filtered} gldSpot={displaySpots.GLD} />
      <ScenarioStrip positions={filtered} spots={displaySpots} />
    </div>
  );
}
