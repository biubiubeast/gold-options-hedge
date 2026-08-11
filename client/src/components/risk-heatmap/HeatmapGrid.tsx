import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CENTERED_METRICS,
  formatCompact,
  formatPrice,
  heatColor,
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

export type HeatmapCellModel = {
  key: string;
  expiry: string;
  strike: number;
  positions: EnrichedRiskPosition[];
  value: number | null;
};

type Props = {
  cells: HeatmapCellModel[];
  expiries: string[];
  strikes: number[];
  metric: HeatmapMetric;
  scale: HeatScale;
  importanceCutoff: number;
  transpose: boolean;
  spot: number;
  callPut: "combined" | CallPut;
  highlightCellKey: string | null;
  onSelectPosition: (position: EnrichedRiskPosition) => void;
};

const statusBorder = {
  LIVE: "border-white/10",
  STALE: "border-amber-400/70",
  WARN: "border-amber-300/50",
  MISSING: "border-orange-500/80 border-dashed",
  FAIL: "border-red-500 ring-1 ring-red-500/40",
} as const;

function zoneFor(strike: number, spot: number, callPut: Props["callPut"]): "ITM" | "ATM" | "OTM" | "NEUTRAL" {
  if (spot <= 0) return "NEUTRAL";
  const distance = (spot - strike) / spot;
  if (Math.abs(distance) <= 0.02) return "ATM";
  if (callPut === "combined") return "NEUTRAL";
  const itm = callPut === "call" ? strike < spot : strike > spot;
  return itm ? "ITM" : "OTM";
}

const zoneClass = {
  ITM: "bg-sky-500/[0.035]",
  ATM: "bg-amber-400/[0.065]",
  OTM: "bg-fuchsia-500/[0.025]",
  NEUTRAL: "",
};

function statusAbbreviation(status: ReturnType<typeof worstStatus>) {
  return ({ LIVE: "", STALE: "S", WARN: "W", MISSING: "M", FAIL: "F" })[status];
}

export function HeatmapGrid({
  cells,
  expiries,
  strikes,
  metric,
  scale,
  importanceCutoff,
  transpose,
  spot,
  callPut,
  highlightCellKey,
  onSelectPosition,
}: Props) {
  const [centerSpot, setCenterSpot] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const range = useMemo(() => spotRangeState(strikes, spot), [spot, strikes]);
  useEffect(() => setCenterSpot(false), [spot, strikes]);
  const displayStrikes = useMemo(() => {
    if (!centerSpot || range.state === "within" || !Number.isFinite(spot)) return strikes;
    return [...new Set([...strikes, Number(spot.toFixed(2))])].sort((a, b) => a - b);
  }, [centerSpot, range.state, spot, strikes]);
  const cellMap = useMemo(() => new Map(cells.map(cell => [cell.key, cell])), [cells]);
  const centered = CENTERED_METRICS.has(metric);
  const columnValues = transpose ? displayStrikes : expiries;
  const rowValues = transpose ? expiries : displayStrikes;
  const template = `76px repeat(${columnValues.length}, minmax(58px, 1fr))`;
  const handleCenterSpot = () => {
    setCenterSpot(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      viewportRef.current?.querySelector<HTMLElement>("[data-spot-synthetic='true']")
        ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }));
  };

  return (
    <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto border border-border/60 bg-background/70" data-testid="risk-heatmap-grid">
      {range.state !== "within" && range.state !== "missing" && (
        <div className="sticky left-0 top-0 z-40 flex h-6 items-center justify-center gap-2 border-b border-amber-400/40 bg-amber-500/15 px-2 text-[10px] text-amber-200">
          <strong>{range.state === "above" ? "SPOT ABOVE RANGE ↑" : "SPOT BELOW RANGE ↓"}</strong>
          <span className="font-mono">{formatCompact(spot)}</span>
          <button type="button" className="underline underline-offset-2" onClick={handleCenterSpot}>Center Spot</button>
        </div>
      )}
      <div className="min-w-[760px]" style={{ display: "grid", gridTemplateColumns: template } as CSSProperties}>
        <div className="sticky left-0 top-0 z-30 flex h-7 items-center border-b border-r border-border/60 bg-background px-1 text-[9px] text-muted-foreground">
          {transpose ? "EXPIRY / STRIKE" : "STRIKE / EXPIRY"}
        </div>
        {columnValues.map(column => {
          const strikeColumn = transpose ? Number(column) : null;
          const isSpotColumn = strikeColumn !== null && range.nearestStrike === strikeColumn;
          return (
            <div key={String(column)} className={`sticky top-0 z-20 flex h-6 items-center justify-center border-b border-r border-border/50 bg-background px-1 font-mono text-[9px] ${isSpotColumn ? "text-amber-300" : "text-foreground/75"}`}>
              {transpose ? formatPrice(strikeColumn) : String(column).slice(5)}{isSpotColumn ? " · SPOT" : ""}
            </div>
          );
        })}

        {rowValues.map(row => {
          const rowStrike = transpose ? null : Number(row);
          const isSpotRow = rowStrike !== null && range.nearestStrike === rowStrike;
          const zone = rowStrike === null ? "NEUTRAL" : zoneFor(rowStrike, spot, callPut);
          return [
            <div
              key={`axis-${String(row)}`}
              className={`sticky left-0 z-10 flex h-[23px] items-center justify-between border-b border-r border-border/50 bg-background px-1.5 font-mono text-[9px] ${isSpotRow ? "text-amber-300" : "text-foreground/75"}`}
            >
              <span>{transpose ? String(row).slice(5) : formatPrice(rowStrike)}</span>
              {rowStrike !== null && <span className="text-[8px] text-muted-foreground">{isSpotRow ? "SPOT" : zone === "NEUTRAL" ? "" : zone}</span>}
            </div>,
            ...columnValues.map(column => {
              const expiry = transpose ? String(row) : String(column);
              const strike = transpose ? Number(column) : Number(row);
              const key = `${expiry}|${strike}`;
              const cell = cellMap.get(key);
              const status = cell ? worstStatus(cell.positions) : "LIVE";
              const normalized = cell?.value === null || cell?.value === undefined ? 0 : scale.normalize(cell.value);
              const important = cell?.value !== null && cell?.value !== undefined && (Math.abs(cell.value) >= importanceCutoff || key === highlightCellKey);
              const topPositions = cell ? [...cell.positions].sort((a, b) => Math.abs(metricValue(b, metric) ?? 0) - Math.abs(metricValue(a, metric) ?? 0)) : [];
              const cellZone = zoneFor(strike, spot, callPut);
              const isSyntheticSpot = range.state !== "within" && centerSpot && strike === Number(spot.toFixed(2));
              return (
                <Tooltip key={key} delayDuration={100}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-cell-key={key}
                      data-spot-synthetic={isSyntheticSpot ? "true" : undefined}
                      className={`relative h-[23px] overflow-hidden border-b border-r px-1 text-center font-mono text-[9px] transition-[filter,outline] hover:z-10 hover:brightness-125 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${zoneClass[cellZone]} ${cell ? statusBorder[status] : "border-border/30"} ${key === highlightCellKey ? "z-10 animate-pulse ring-2 ring-white/90" : ""} ${isSyntheticSpot ? "border-amber-300/80 bg-amber-400/15" : ""}`}
                      style={cell?.value === null || cell?.value === undefined ? undefined : { backgroundColor: heatColor(normalized, centered) }}
                      onClick={() => topPositions[0] && onSelectPosition(topPositions[0])}
                      aria-label={cell ? `${key} ${formatCompact(cell.value, metric)} ${status}` : `${key} no position`}
                    >
                      {important ? <span className="font-semibold text-white">{formatCompact(cell!.value, metric)}</span> : cell ? <span className="text-white/30">·</span> : ""}
                      {cell && cell.positions.length > 1 && <span className="absolute bottom-0 right-0.5 text-[7px] leading-none text-white/55">{cell.positions.length}</span>}
                      {cell && status !== "LIVE" && <span className="absolute left-0.5 top-0 text-[7px] font-bold leading-none text-white">{statusAbbreviation(status)}</span>}
                      {isSyntheticSpot && <span className="text-[8px] text-amber-200">SPOT</span>}
                    </button>
                  </TooltipTrigger>
                  {cell && (
                    <TooltipContent side="right" className="w-80 border border-border bg-popover p-2 text-popover-foreground shadow-xl">
                      <div className="flex items-center justify-between border-b border-border/50 pb-1">
                        <strong className="font-mono text-xs">{expiry} · {formatPrice(strike)}</strong>
                        <span className="text-[10px] text-muted-foreground">{cell.positions.length} position(s) · {status}</span>
                      </div>
                      <div className="mt-1 space-y-1">
                        {topPositions.slice(0, 5).map(position => (
                          <div key={position.id} className="grid grid-cols-[1fr_auto] gap-2 text-[10px]">
                            <span className="truncate">{positionLabel(position)} · {position.broker}/{position.account}</span>
                            <span className="font-mono">{formatCompact(metricValue(position, metric), metric)}</span>
                            <span className="truncate text-muted-foreground">Qty {formatCompact(position.netQty)} · {position.source ?? "MISSING SOURCE"}</span>
                            <span className="font-mono text-muted-foreground">{position.dataStatus}</span>
                          </div>
                        ))}
                      </div>
                      {topPositions[0]?.rollPriority && (
                        <details className="mt-2 border-t border-border/50 pt-1 text-[10px]">
                          <summary className="cursor-pointer">Roll {topPositions[0].rollPriority.total.toFixed(0)} · breakdown</summary>
                          {topPositions[0].rollPriority.factors.map(factor => (
                            <div key={factor.key} className="mt-1 grid grid-cols-[1fr_auto] gap-2 text-muted-foreground">
                              <span>{factor.label} · {factor.reason}</span>
                              <span className="font-mono">{factor.contribution.toFixed(1)} / {(factor.weight * 100).toFixed(0)}</span>
                            </div>
                          ))}
                        </details>
                      )}
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}
