import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CENTERED_METRICS,
  METRIC_LABELS,
  formatCompact,
  formatPrice,
  heatColor,
  magnitudeHeatColor,
  metricValue,
  positionLabel,
  spotRangeState,
  worstStatus,
  type CallPut,
  type EnrichedRiskPosition,
  type HeatScale,
  type HeatmapMetric,
} from "@shared/riskHeatmap";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export type HeatmapCellModel = { key: string; expiry: string; strike: number; positions: EnrichedRiskPosition[]; value: number | null; listed?: boolean; held?: boolean };
export type CellLabelMode = "none" | "top" | "all";
export type HoverDataPreset = "risk" | "market" | "pnl" | "all";

type Props = {
  cells: HeatmapCellModel[];
  expiries: string[];
  strikes: number[];
  metric: HeatmapMetric;
  scale: HeatScale;
  importanceCutoff: number;
  transpose: boolean;
  reverseStrikes: boolean;
  cellSize: number;
  fitAll: boolean;
  spot: number;
  callPut: "combined" | CallPut;
  highlightCellKey: string | null;
  labelMode: CellLabelMode;
  hoverPreset: HoverDataPreset;
  sequentialMagnitude: boolean;
  onSelectPosition: (position: EnrichedRiskPosition) => void;
};

const statusBorder = {
  LIVE: "border-white/[0.07]", STALE: "border-amber-400/70", WARN: "border-amber-300/50",
  MISSING: "border-orange-500/80 border-dashed", FAIL: "border-red-500 ring-1 ring-red-500/40",
} as const;

function zoneFor(strike: number, spot: number, callPut: Props["callPut"]): "ITM" | "ATM" | "OTM" | "NEUTRAL" {
  if (spot <= 0) return "NEUTRAL";
  const distance = (spot - strike) / spot;
  if (Math.abs(distance) <= 0.02) return "ATM";
  if (callPut === "combined") return "NEUTRAL";
  return (callPut === "call" ? strike < spot : strike > spot) ? "ITM" : "OTM";
}

const zoneClass = { ITM: "bg-sky-500/[0.03]", ATM: "bg-amber-400/[0.06]", OTM: "bg-fuchsia-500/[0.02]", NEUTRAL: "" };
const statusAbbreviation = (status: ReturnType<typeof worstStatus>) => ({ LIVE: "", STALE: "S", WARN: "W", MISSING: "M", FAIL: "F" })[status];

function TooltipPosition({ position, metric, preset }: { position: EnrichedRiskPosition; metric: HeatmapMetric; preset: HoverDataPreset }) {
  const rows: Array<[string, string]> = [["Selected metric", formatCompact(metricValue(position, metric), metric)]];
  if (preset === "risk" || preset === "all") rows.push(
    ["Unit Δ / Total Δ", `${formatCompact(position.unitDelta)} / ${formatCompact(position.totalDeltaXAU)} oz`],
    ["Γ / Θ / Vega", `${formatCompact(position.totalGammaXAU)} / $${formatCompact(position.totalThetaUSD)}/d / $${formatCompact(position.totalVegaUSD)}`],
    ["DTE / Roll", `${position.dte}d / ${position.rollPriority.total.toFixed(0)}`],
  );
  if (preset === "market" || preset === "all") rows.push(
    ["Mark / IV", `${formatPrice(position.markPrice)} / ${formatCompact(position.markIV, "markIV")}`],
    ["Bid / Ask", `${formatPrice(position.bid)} / ${formatPrice(position.ask)}`],
    ["Bid IV / Ask IV", `${formatCompact(position.bidIV, "bidIV")} / ${formatCompact(position.askIV, "askIV")}`],
    ["IV spread", formatCompact(position.ivSpread, "ivSpread")],
    ["Source / As-of", `${position.source ?? "MISSING"} / ${position.quoteTime?.slice(0, 19).replace("T", " ") ?? "MISSING"}`],
    ["OI / Volume", `${formatCompact(position.openInterest ?? null)} / ${formatCompact(position.volume ?? null)}`],
  );
  if (preset === "pnl" || preset === "all") rows.push(
    ["Qty / Multiplier", `${formatCompact(position.netQty)} / ${formatCompact(position.contractMultiplier)}`],
    ["MV / Entry", `$${formatCompact(position.MV)} / $${formatCompact(position.entryCost)}`],
    ["UPL", `$${formatCompact(position.UPL)}`],
  );
  return <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px]">{rows.map(([label, value]) => <div key={label} className="contents"><span className="text-muted-foreground">{label}</span><span className="text-right font-mono">{value}</span></div>)}</div>;
}

export function HeatmapGrid({ cells, expiries, strikes, metric, scale, importanceCutoff, transpose, reverseStrikes, cellSize, fitAll, spot, callPut, highlightCellKey, labelMode, hoverPreset, sequentialMagnitude, onSelectPosition }: Props) {
  const [centerSpot, setCenterSpot] = useState(false);
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const centeredOnceRef = useRef<string | null>(null);
  const range = useMemo(() => spotRangeState(strikes, spot), [spot, strikes]);
  useEffect(() => setCenterSpot(false), [spot, strikes]);
  const displayStrikes = useMemo(() => {
    const values = !centerSpot || range.state === "within" || !Number.isFinite(spot)
      ? [...strikes]
      : [...new Set([...strikes, Number(spot.toFixed(2))])];
    return values.sort((a, b) => reverseStrikes ? b - a : a - b);
  }, [centerSpot, range.state, reverseStrikes, spot, strikes]);
  const cellMap = useMemo(() => new Map(cells.map(cell => [cell.key, cell])), [cells]);
  const centered = CENTERED_METRICS.has(metric) && !sequentialMagnitude;
  const columnValues = transpose ? displayStrikes : expiries;
  const rowValues = transpose ? expiries : displayStrikes;
  const columnMin = fitAll ? 1 : Math.max(8, Math.round(cellSize * 2.6));
  const axisWidth = fitAll ? 52 : 82;
  const template = `${axisWidth}px repeat(${columnValues.length}, minmax(${columnMin}px, 1fr))`;
  const minWidth = fitAll ? 0 : Math.max(480, axisWidth + columnValues.length * columnMin);
  const rowHeight = fitAll
    ? `max(2px, min(${cellSize}px, calc((100vh - 238px) / ${Math.max(1, rowValues.length)})))`
    : `${cellSize}px`;
  const scrollToSpot = (behavior: ScrollBehavior = "smooth") => requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = viewportRef.current?.querySelector<HTMLElement>("[data-spot-row='true'], [data-spot-synthetic='true']");
    target?.scrollIntoView({ behavior, block: "center", inline: "nearest" });
  }));
  const handleCenterSpot = () => {
    if (range.state !== "within") setCenterSpot(true);
    scrollToSpot();
  };
  useEffect(() => {
    if (transpose || range.nearestStrike === null || !cells.length) return;
    const marker = `${range.nearestStrike}|${cells.length}`;
    if (centeredOnceRef.current === marker) return;
    centeredOnceRef.current = marker;
    scrollToSpot("auto");
  }, [cells.length, range.nearestStrike, transpose]);
  const colorFor = (value: number) => {
    const normalized = scale.normalize(sequentialMagnitude ? Math.abs(value) : value);
    return sequentialMagnitude ? magnitudeHeatColor(normalized) : heatColor(normalized, centered);
  };
  const legendMaximum = sequentialMagnitude ? scale.clipHigh : scale.centered ? scale.p99Abs : scale.clipHigh;
  const legendGradient = sequentialMagnitude
    ? "linear-gradient(to top, rgb(37 99 235), rgb(34 211 238), rgb(250 204 21), rgb(239 68 68))"
    : centered ? "linear-gradient(to top, rgb(224 70 78), rgb(35 35 45), rgb(40 160 205))" : "linear-gradient(to top, rgb(30 35 50), rgb(222 164 48))";

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden border border-border/60 bg-background/70" data-testid="risk-heatmap-grid">
      <div ref={viewportRef} className="min-w-0 flex-1 overflow-auto">
        {range.state !== "within" && range.state !== "missing" && <div className="sticky left-0 top-0 z-40 flex h-5 items-center justify-center gap-2 border-b border-amber-400/40 bg-amber-500/15 px-2 text-[9px] text-amber-200"><strong>{range.state === "above" ? "SPOT ABOVE RANGE ↑" : "SPOT BELOW RANGE ↓"}</strong><span className="font-mono">{formatCompact(spot)}</span><button type="button" className="underline" onClick={handleCenterSpot}>Center Spot</button></div>}
        <div style={{ display: "grid", gridTemplateColumns: template, minWidth } as CSSProperties}>
          <div className="sticky left-0 top-0 z-30 flex h-6 items-center border-b border-r border-border/60 bg-background px-1 text-[8px] text-muted-foreground">{transpose ? "EXP / STRIKE" : "STRIKE / EXP"}</div>
          {columnValues.map(column => {
            const strikeColumn = transpose ? Number(column) : null;
            const isSpotColumn = strikeColumn !== null && range.nearestStrike === strikeColumn;
            return <div key={String(column)} className={`sticky top-0 z-20 flex h-6 items-center justify-center truncate border-b border-r border-border/40 bg-background px-0.5 font-mono text-[8px] ${isSpotColumn ? "border-x-amber-300/70 text-amber-300" : "text-foreground/75"}`} title={String(column)}>{transpose ? formatPrice(strikeColumn) : String(column).slice(5)}{isSpotColumn ? "•" : ""}</div>;
          })}
          {rowValues.flatMap(row => {
            const rowStrike = transpose ? null : Number(row);
            const isSpotRow = rowStrike !== null && range.nearestStrike === rowStrike;
            const zone = rowStrike === null ? "NEUTRAL" : zoneFor(rowStrike, spot, callPut);
            const axis = <div key={`axis-${String(row)}`} data-spot-row={isSpotRow ? "true" : undefined} style={{ height: rowHeight }} className={`sticky left-0 z-10 flex items-center justify-between overflow-hidden border-b border-r bg-background px-1 font-mono text-[8px] ${isSpotRow ? "border-y-amber-300/80 bg-amber-400/10 text-amber-300" : "border-border/40 text-foreground/75"}`}><span>{transpose ? String(row).slice(5) : formatPrice(rowStrike)}</span>{!fitAll && rowStrike !== null && <span className="text-[7px]">{isSpotRow ? `SPOT ${formatPrice(spot)}` : zone === "NEUTRAL" ? "" : zone}</span>}</div>;
            const buttons = columnValues.map(column => {
              const expiry = transpose ? String(row) : String(column);
              const strike = transpose ? Number(column) : Number(row);
              const key = `${expiry}|${strike}`;
              const cell = cellMap.get(key);
              const status = cell ? worstStatus(cell.positions) : "LIVE";
              const important = cell?.value != null && (Math.abs(cell.value) >= importanceCutoff || key === highlightCellKey);
              const showLabel = cell && cell.value !== null && (labelMode === "all" || (labelMode === "top" && important));
              const topPositions = cell ? [...cell.positions].sort((a, b) => Math.abs(metricValue(b, metric) ?? 0) - Math.abs(metricValue(a, metric) ?? 0)) : [];
              const isSyntheticSpot = range.state !== "within" && centerSpot && strike === Number(spot.toFixed(2));
              const spotLine = range.nearestStrike === strike;
              return <Tooltip key={key} delayDuration={80} open={hoveredCellKey === key} onOpenChange={open => setHoveredCellKey(open ? key : null)}><TooltipTrigger asChild><button
                type="button" data-cell-key={key} data-spot-synthetic={isSyntheticSpot ? "true" : undefined}
                className={`relative overflow-hidden border-b border-r px-0.5 text-center font-mono text-[7px] transition-[filter,outline] hover:z-10 hover:brightness-125 focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-primary ${zoneClass[zoneFor(strike, spot, callPut)]} ${cell ? statusBorder[status] : "border-border/[0.09] opacity-35"} ${cell?.listed && !cell.held ? "border-cyan-300/80 ring-1 ring-inset ring-cyan-400/35" : ""} ${cell?.held ? "border-amber-200 ring-1 ring-inset ring-amber-300/90" : ""} ${key === highlightCellKey ? "z-10 animate-pulse ring-2 ring-white/90" : ""} ${spotLine ? "border-y-amber-300/70" : ""} ${isSyntheticSpot ? "bg-amber-400/15" : ""}`}
                style={{ height: rowHeight, ...(cell?.value == null ? {} : { backgroundColor: colorFor(cell.value) }) }}
                onClick={() => topPositions[0] && onSelectPosition(topPositions[0])}
                onMouseEnter={() => cell && setHoveredCellKey(key)}
                onMouseLeave={() => setHoveredCellKey(current => current === key ? null : current)}
                onFocus={() => cell && setHoveredCellKey(key)}
                onBlur={() => setHoveredCellKey(current => current === key ? null : current)}
                aria-label={cell ? `${key} ${formatCompact(cell.value, metric)} ${cell.held ? "held" : "listed no position"} ${status}` : `${key} unavailable not listed`}
              >{showLabel && <span className="font-semibold text-white drop-shadow-sm">{formatCompact(cell!.value, metric)}</span>}{cell && cell.positions.length > 1 && (labelMode !== "none" || cell.held) && <span className="absolute bottom-0 right-0 text-[6px] leading-none text-white/70">{cell.positions.length}</span>}{cell && status !== "LIVE" && (cell.held || labelMode !== "none") && <span className="absolute left-0 top-0 text-[6px] font-bold leading-none text-white">{statusAbbreviation(status)}</span>}{isSyntheticSpot && <span className="text-[7px] text-amber-200">SPOT</span>}</button></TooltipTrigger>
                {cell && <TooltipContent side="right" sideOffset={6} collisionPadding={12} className="z-[100] w-80 border border-border bg-popover p-2 text-popover-foreground shadow-2xl"><div className="flex items-center justify-between border-b border-border/50 pb-1"><strong className="font-mono text-xs">{expiry} · {formatPrice(strike)}</strong><span className="text-[9px] text-muted-foreground">{cell.held ? "HELD POSITION" : "LISTED / NO POSITION"} · {status}</span></div><div className="mt-1 rounded-sm bg-primary/10 px-2 py-1 text-[10px]"><span className="text-muted-foreground">Cell {METRIC_LABELS[metric]} </span><strong className="float-right font-mono text-primary">{formatCompact(cell.value, metric)}</strong></div><div className="mt-1 space-y-2">{topPositions.slice(0, 5).map(position => <div key={position.id}><div className="mb-1 flex items-center justify-between gap-2 text-[10px]"><span className="truncate font-medium">{positionLabel(position)} · {position.account}</span><span className="font-mono">{formatCompact(metricValue(position, metric), metric)}</span></div><TooltipPosition position={position} metric={metric} preset={hoverPreset} /></div>)}</div><p className="mt-2 border-t border-border/50 pt-1 text-[9px] text-muted-foreground">点击查看完整行情、Greeks、数据质量与 Roll 原因</p></TooltipContent>}
              </Tooltip>;
            });
            return [axis, ...buttons];
          })}
        </div>
      </div>
      <aside className="flex w-[62px] shrink-0 flex-col items-center border-l border-border/60 bg-card/50 px-1 py-2" aria-label="vertical heatmap legend">
        <span className="text-center text-[7px] uppercase leading-tight text-muted-foreground">{sequentialMagnitude ? "ABS RISK" : scale.centered ? "SIGNED" : "RISK"}<br />P99 CLIP</span>
        <span className="mt-1 font-mono text-[7px] text-foreground">{formatCompact(legendMaximum, metric)}</span>
        <div className="my-1 min-h-16 w-3 flex-1 border border-white/10" style={{ background: legendGradient }} />
        {sequentialMagnitude ? <><span className="font-mono text-[7px] text-muted-foreground">{formatCompact(legendMaximum * 0.5, metric)}</span><span className="mt-auto font-mono text-[7px] text-blue-300">0</span></> : <span className="font-mono text-[7px] text-muted-foreground">{scale.centered ? formatCompact(-legendMaximum, metric) : "0"}</span>}
        <button type="button" onClick={handleCenterSpot} className="mt-1 text-center text-[7px] leading-tight text-amber-300 underline">CENTER<br />SPOT {formatPrice(spot)}</button>
        <span className="mt-1 text-center text-[6px] leading-tight text-cyan-200">CYAN<br />LISTED</span>
        <span className="mt-1 text-center text-[6px] leading-tight text-amber-200">GOLD<br />HELD</span>
      </aside>
    </div>
  );
}
