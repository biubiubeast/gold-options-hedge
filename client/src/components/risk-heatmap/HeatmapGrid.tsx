import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CENTERED_METRICS,
  HELD_ONLY_HEATMAP_METRICS,
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
import { cloneElement, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEventHandler, type ReactElement } from "react";

export type HeatmapCellModel = { key: string; expiry: string; strike: number; positions: EnrichedRiskPosition[]; value: number | null; listed?: boolean; held?: boolean };
export type CellLabelMode = "none" | "held" | "top" | "all";
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
    ["Qty / Notional", `${formatCompact(position.netQty)} / $${formatCompact(position.notionalSizeUSD)}`],
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

function ExpiryTooltip({ expiry, positions, preset, children }: { expiry: string; positions: EnrichedRiskPosition[]; preset: HoverDataPreset; children: ReactElement<{ onClick?: MouseEventHandler }> }) {
  const [open, setOpen] = useState(false);
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
  const rows: Array<[string, string]> = [];
  if (preset === "risk" || preset === "all") rows.push(
    ["Held / Listed", `${held.length} / ${positions.length}`],
    ["Total Δ / Γ", `${formatCompact(sum(held.map(position => position.totalDeltaXAU)))} oz / ${formatCompact(sum(held.map(position => position.totalGammaXAU)))}`],
    ["Total Θ / Vega", `$${formatCompact(sum(held.map(position => position.totalThetaUSD)))}/d / $${formatCompact(sum(held.map(position => position.totalVegaUSD)))}`],
    ["Max Roll / Worst", `${formatCompact(Math.max(...held.map(position => position.rollPriority.total), 0), "rollPriority")} / ${worstStatus(positions)}`],
  );
  if (preset === "market" || preset === "all") rows.push(
    ["Avg Mark / Bid / Ask IV", `${formatCompact(average(positions.map(position => position.markIV)), "markIV")} / ${formatCompact(average(positions.map(position => position.bidIV)), "bidIV")} / ${formatCompact(average(positions.map(position => position.askIV)), "askIV")}`],
    ["OI / Volume", `${formatCompact(sum(positions.map(position => position.openInterest ?? null)))} / ${formatCompact(sum(positions.map(position => position.volume ?? null)))}`],
    ["Stale / Missing", `${positions.filter(position => position.dataStatus === "STALE").length} / ${positions.filter(position => position.dataStatus === "MISSING" || position.dataStatus === "FAIL").length}`],
    ["Latest quote", positions.map(position => position.quoteTime).filter((value): value is string => Boolean(value)).sort().at(-1)?.slice(0, 19).replace("T", " ") ?? "MISSING"],
  );
  if (preset === "pnl" || preset === "all") rows.push(
    ["Net / Gross Qty", `${formatCompact(sum(held.map(position => position.netQty)))} / ${formatCompact(sum(held.map(position => Math.abs(position.netQty))))}`],
    ["Gross Notional", `$${formatCompact(sum(held.map(position => position.notionalSizeUSD === null ? null : Math.abs(position.notionalSizeUSD))))}`],
    ["MV / Entry", `$${formatCompact(sum(held.map(position => position.MV)))} / $${formatCompact(sum(held.map(position => position.entryCost)))}`],
    ["UPL", `$${formatCompact(sum(held.map(position => position.UPL)))}`],
  );
  return <Tooltip open={open} onOpenChange={setOpen} delayDuration={100}><TooltipTrigger asChild>{cloneElement(children, { onClick: () => setOpen(value => !value) })}</TooltipTrigger><TooltipContent side="bottom" sideOffset={4} collisionPadding={10} className="z-[110] w-80 border border-border bg-popover p-2 text-popover-foreground shadow-2xl"><div className="flex items-center justify-between border-b border-border/50 pb-1"><strong className="font-mono text-xs">EXPIRY {expiry}</strong><span className="text-[9px] text-muted-foreground">{preset.toUpperCase()} SUMMARY</span></div><div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">{rows.map(([label, value]) => <div key={label} className="contents"><span className="text-muted-foreground">{label}</span><span className="text-right font-mono">{value}</span></div>)}</div></TooltipContent></Tooltip>;
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
  const centered = scale.centered;
  const columnValues = transpose ? displayStrikes : expiries;
  const rowValues = transpose ? expiries : displayStrikes;
  const columnMin = fitAll ? 1 : Math.max(8, Math.round(cellSize * 2.6));
  const axisWidth = fitAll ? 52 : 82;
  const template = `${axisWidth}px repeat(${columnValues.length}, minmax(${columnMin}px, 1fr))`;
  const minWidth = fitAll ? 0 : Math.max(480, axisWidth + columnValues.length * columnMin);
  const rowHeight = fitAll
    ? `max(0.65px, min(${cellSize}px, calc((100vh - 350px) / ${Math.max(1, rowValues.length)})))`
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
  const fixedRange = scale.rangeBasis !== "distribution";
  const legendMaximum = scale.centered && !fixedRange ? scale.p99Abs : scale.clipHigh;
  const legendMinimum = fixedRange ? scale.clipLow : scale.centered ? -scale.p99Abs : 0;
  const legendMidpoint = (legendMinimum + legendMaximum) / 2;
  const legendGradient = "linear-gradient(to top, rgb(22 163 74), rgb(250 204 21), rgb(239 68 68))";

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden border border-border/60 bg-background/70" data-testid="risk-heatmap-grid">
      <div ref={viewportRef} className="min-w-0 flex-1 overflow-auto">
        {range.state !== "within" && range.state !== "missing" && <div className="sticky left-0 top-0 z-40 flex h-5 items-center justify-center gap-2 border-b border-amber-400/40 bg-amber-500/15 px-2 text-[9px] text-amber-200"><strong>{range.state === "above" ? "SPOT ABOVE RANGE ↑" : "SPOT BELOW RANGE ↓"}</strong><span className="font-mono">{formatCompact(spot)}</span><button type="button" className="underline" onClick={handleCenterSpot}>Center Spot</button></div>}
        <div style={{ display: "grid", gridTemplateColumns: template, minWidth } as CSSProperties}>
          <div className="sticky left-0 top-0 z-30 flex h-6 items-center border-b border-r border-border/60 bg-background px-1 text-[8px] text-muted-foreground">{transpose ? "EXP / STRIKE" : "STRIKE / EXP"}</div>
          {columnValues.map(column => {
            const strikeColumn = transpose ? Number(column) : null;
            const isSpotColumn = strikeColumn !== null && range.nearestStrike === strikeColumn;
            const label = <button type="button" data-expiry-header={!transpose ? String(column) : undefined} aria-label={!transpose ? `Expiry ${String(column)} summary` : undefined} className={`sticky top-0 z-20 flex h-6 items-center justify-center truncate border-b border-r border-border/40 bg-background px-0.5 font-mono text-[8px] ${isSpotColumn ? "border-x-amber-300/70 text-amber-300" : "text-foreground/75"}`} title={String(column)}>{transpose ? formatPrice(strikeColumn) : String(column).slice(5)}{isSpotColumn ? "•" : ""}</button>;
            return transpose ? <div key={String(column)} className="contents">{label}</div> : <ExpiryTooltip key={String(column)} expiry={String(column)} positions={cells.filter(cell => cell.expiry === String(column)).flatMap(cell => cell.positions)} preset={hoverPreset}>{label}</ExpiryTooltip>;
          })}
          {rowValues.flatMap(row => {
            const rowStrike = transpose ? null : Number(row);
            const isSpotRow = rowStrike !== null && range.nearestStrike === rowStrike;
            const zone = rowStrike === null ? "NEUTRAL" : zoneFor(rowStrike, spot, callPut);
            const axisLabel = <button type="button" data-expiry-header={transpose ? String(row) : undefined} aria-label={transpose ? `Expiry ${String(row)} summary` : undefined} data-spot-row={isSpotRow ? "true" : undefined} style={{ height: rowHeight }} className={`sticky left-0 z-10 flex items-center justify-between overflow-hidden border-b border-r bg-background px-1 font-mono text-[8px] ${isSpotRow ? "border-y-amber-300/80 bg-amber-400/10 text-amber-300" : "border-border/40 text-foreground/75"}`}><span>{transpose ? String(row).slice(5) : formatPrice(rowStrike)}</span>{!fitAll && rowStrike !== null && <span className="text-[7px]">{isSpotRow ? `SPOT ${formatPrice(spot)}` : zone === "NEUTRAL" ? "" : zone}</span>}</button>;
            const axis = transpose ? <ExpiryTooltip key={`axis-${String(row)}`} expiry={String(row)} positions={cells.filter(cell => cell.expiry === String(row)).flatMap(cell => cell.positions)} preset={hoverPreset}>{axisLabel}</ExpiryTooltip> : <div key={`axis-${String(row)}`} className="contents">{axisLabel}</div>;
            const buttons = columnValues.map(column => {
              const expiry = transpose ? String(row) : String(column);
              const strike = transpose ? Number(column) : Number(row);
              const key = `${expiry}|${strike}`;
              const cell = cellMap.get(key);
              const status = cell ? worstStatus(cell.positions) : "LIVE";
              const important = cell?.value != null && (Math.abs(cell.value) >= importanceCutoff || key === highlightCellKey);
              const showLabel = cell && cell.value !== null && (
                labelMode === "all"
                || (labelMode === "held" && cell.held)
                || (labelMode === "top" && important)
              );
              const topPositions = cell ? [...cell.positions].sort((a, b) => Math.abs(metricValue(b, metric) ?? 0) - Math.abs(metricValue(a, metric) ?? 0)) : [];
              const heldUnderlyings = new Set(cell?.positions
                .filter(position => position.positionKind !== "listed")
                .map(position => position.underlying) ?? []);
              const heldMarker = heldUnderlyings.size > 1 ? "B" : heldUnderlyings.has("XAUT") ? "X" : heldUnderlyings.has("GLD") ? "G" : null;
              const isSyntheticSpot = range.state !== "within" && centerSpot && strike === Number(spot.toFixed(2));
              const spotLine = range.nearestStrike === strike;
              return <Tooltip key={key} delayDuration={80} open={hoveredCellKey === key} onOpenChange={open => setHoveredCellKey(open ? key : null)}><TooltipTrigger asChild><button
                type="button" data-cell-key={key} data-held={cell?.held ? "true" : "false"} data-spot-synthetic={isSyntheticSpot ? "true" : undefined}
                className={`relative overflow-hidden border-b border-r px-0.5 text-center font-mono text-[7px] transition-[filter,outline] hover:z-10 hover:brightness-125 focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-primary ${zoneClass[zoneFor(strike, spot, callPut)]} ${cell ? statusBorder[status] : "border-border/[0.07] opacity-30"} ${cell?.listed && !cell.held ? "border-cyan-300/45" : ""} ${cell?.held ? "z-[3] border border-amber-200" : ""} ${key === highlightCellKey ? "z-10 animate-pulse ring-2 ring-white/90" : ""} ${spotLine ? "border-y-amber-300/70" : ""} ${isSyntheticSpot ? "bg-amber-400/15" : ""}`}
                style={{
                  height: rowHeight,
                  ...(cell?.value == null ? {} : { backgroundColor: colorFor(cell.value) }),
                }}
                onClick={() => topPositions[0] && onSelectPosition(topPositions[0])}
                onMouseEnter={() => cell && setHoveredCellKey(key)}
                onMouseLeave={() => setHoveredCellKey(current => current === key ? null : current)}
                onFocus={() => cell && setHoveredCellKey(key)}
                onBlur={() => setHoveredCellKey(current => current === key ? null : current)}
                aria-label={cell ? `${key} ${formatCompact(cell.value, metric)} ${cell.held ? "held" : "listed no position"} ${status}` : `${key} unavailable not listed`}
              >{showLabel && <span className="block max-w-full truncate px-[5px] font-semibold text-white drop-shadow-sm">{formatCompact(cell!.value, metric)}</span>}{heldMarker && <span aria-hidden="true" title={heldMarker === "X" ? "XAUT held" : heldMarker === "G" ? "GLD held" : "GLD + XAUT held"} className="pointer-events-none absolute right-px top-1/2 -translate-y-1/2 font-mono text-[6px] font-black leading-none text-amber-100 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">{heldMarker}</span>}{cell && cell.positions.length > 1 && labelMode !== "none" && <span className="absolute bottom-0 right-0 text-[5px] leading-none text-white/60">{cell.positions.length}</span>}{cell && status !== "LIVE" && (cell.held || labelMode !== "none") && <span className="absolute left-0 top-0 text-[6px] font-bold leading-none text-white">{statusAbbreviation(status)}</span>}{isSyntheticSpot && <span className="text-[7px] text-amber-200">SPOT</span>}</button></TooltipTrigger>
                {cell && <TooltipContent side="right" sideOffset={6} collisionPadding={12} className="z-[100] w-80 border border-border bg-popover p-2 text-popover-foreground shadow-2xl"><div className="flex items-center justify-between border-b border-border/50 pb-1"><strong className="font-mono text-xs">{expiry} · {formatPrice(strike)}</strong><span className="text-[9px] text-muted-foreground">{cell.held ? "HELD POSITION" : "LISTED / NO POSITION"} · {status}</span></div><div className="mt-1 rounded-sm bg-primary/10 px-2 py-1 text-[10px]"><span className="text-muted-foreground">Cell {METRIC_LABELS[metric]} </span><strong className="float-right font-mono text-primary">{cell.value === null && HELD_ONLY_HEATMAP_METRICS.has(metric) ? "NO POSITION · NOT COLORED" : formatCompact(cell.value, metric)}</strong></div><div className="mt-1 space-y-2">{topPositions.slice(0, 5).map(position => <div key={position.id}><div className="mb-1 flex items-center justify-between gap-2 text-[10px]"><span className="truncate font-medium">{positionLabel(position)} · {position.account}</span><span className="font-mono">{formatCompact(metricValue(position, metric), metric)}</span></div><TooltipPosition position={position} metric={metric} preset={hoverPreset} /></div>)}</div><p className="mt-2 border-t border-border/50 pt-1 text-[9px] text-muted-foreground">点击查看完整行情、Greeks、数据质量与 Roll 原因</p></TooltipContent>}
              </Tooltip>;
            });
            return [axis, ...buttons];
          })}
        </div>
      </div>
      <aside className="flex w-[62px] shrink-0 flex-col items-center border-l border-border/60 bg-card/50 px-1 py-2" aria-label="vertical heatmap legend">
        <span className="text-center text-[7px] uppercase leading-tight text-muted-foreground">{sequentialMagnitude ? "ABS VALUE" : scale.centered ? "SIGNED" : "RAW VALUE"}<br />{scale.rangeBasis === "held" ? "HELD RANGE" : scale.custom ? "CUSTOM" : "P99 CLIP"}</span>
        <span className="mt-1 font-mono text-[7px] text-foreground">{formatCompact(legendMaximum, metric)}</span>
        <div className="my-1 min-h-16 w-3 flex-1 border border-white/10" style={{ background: legendGradient }} />
        <span className="font-mono text-[7px] text-yellow-300">{formatCompact(legendMidpoint, metric)}</span><span className="mt-auto font-mono text-[7px] text-emerald-300">{formatCompact(legendMinimum, metric)}</span>
        <button type="button" onClick={handleCenterSpot} className="mt-1 text-center text-[7px] leading-tight text-amber-300 underline">CENTER<br />SPOT {formatPrice(spot)}</button>
        <span className="mt-1 text-center text-[6px] leading-tight text-cyan-200">THIN CYAN<br />LISTED</span>
        <span className="mt-1 text-center text-[6px] font-semibold leading-tight text-amber-100">THIN GOLD<br />HELD</span>
        <span className="mt-1 text-center font-mono text-[6px] font-bold leading-tight text-amber-100">G / X / B<br />HELD U</span>
        <span className="mt-1 text-center font-mono text-[6px] leading-tight text-muted-foreground">S/W/M/F<br />DATA</span>
      </aside>
    </div>
  );
}
