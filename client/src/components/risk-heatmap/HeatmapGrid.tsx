import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CENTERED_METRICS,
  HELD_ONLY_HEATMAP_METRICS,
  METRIC_LABELS,
  formatCompact,
  formatPrice,
  formatSpotPrice,
  formatStrike,
  formatStrikeDistanceFromSpot,
  heatColor,
  magnitudeHeatColor,
  expiryHeldMetricTotal,
  metricDistribution,
  metricValue,
  nearestStrikeLevels,
  positionLabel,
  spotRangeState,
  worstStatus,
  type CallPut,
  type EnrichedRiskPosition,
  type HeatScale,
  type HeatmapMetric,
  type IvValueSource,
  type MoneynessFilter,
} from "@shared/riskHeatmap";
import {
  cloneElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactElement,
} from "react";
import type { PortfolioSettings } from "@/lib/portfolio";
import type { TargetOptionMode } from "@/lib/heatmapTargets";

export type HeatmapCellModel = {
  key: string;
  expiry: string;
  strike: number;
  positions: EnrichedRiskPosition[];
  value: number | null;
  ungradedReason?: "missing" | "zero" | null;
  listed?: boolean;
  held?: boolean;
};
export type CellLabelMode = "none" | "held" | "top" | "bottom" | "all";
export type HoverDataPreset = "risk" | "market" | "pnl" | "all";

type Props = {
  cells: HeatmapCellModel[];
  expiries: string[];
  strikes: number[];
  metric: HeatmapMetric;
  ivSource: IvValueSource;
  scale: HeatScale;
  importanceCutoff: number;
  lowImportanceCutoff: number;
  transpose: boolean;
  reverseStrikes: boolean;
  cellSize: number;
  fitAll: boolean;
  spot: number;
  callPut: "combined" | CallPut;
  moneyness: MoneynessFilter;
  atmStrike?: number | null;
  highlightCellKey: string | null;
  labelMode: CellLabelMode;
  hoverPreset: HoverDataPreset;
  sequentialMagnitude: boolean;
  heldCellContent: {
    underlying: boolean;
    callPut: boolean;
    dataStatus: boolean;
  };
  hoverContent: PortfolioSettings["heatmapHoverContent"];
  cellDetailEnabled: boolean;
  expiryDetailEnabled: boolean;
  targetMode: TargetOptionMode;
  targetCellKeys: ReadonlySet<string>;
  onTargetCellChange: (cellKey: string, selected: boolean) => void;
  onSelectPosition: (position: EnrichedRiskPosition) => void;
  onSelectExpiry: (expiry: string, positions: EnrichedRiskPosition[]) => void;
};

function zoneFor(
  strike: number,
  spot: number,
  callPut: Props["callPut"],
  atmStrikes: ReadonlySet<number>
): "ITM" | "ATM" | "OTM" | "NEUTRAL" {
  if (spot <= 0) return "NEUTRAL";
  if (atmStrikes.has(strike)) return "ATM";
  if (callPut === "combined") return "NEUTRAL";
  return (callPut === "call" ? strike < spot : strike > spot) ? "ITM" : "OTM";
}

const zoneClass = {
  ITM: "bg-sky-500/[0.03]",
  ATM: "bg-amber-400/[0.06]",
  OTM: "bg-fuchsia-500/[0.02]",
  NEUTRAL: "",
};
const heldStatusAbbreviation = (status: ReturnType<typeof worstStatus>) =>
  ({ LIVE: "L", STALE: "S", WARN: "W", MISSING: "M", FAIL: "F" })[status];
const heldStatusColor = (status: ReturnType<typeof worstStatus>) =>
  ({
    LIVE: "text-emerald-300",
    STALE: "text-amber-200",
    WARN: "text-yellow-200",
    MISSING: "text-orange-200",
    FAIL: "text-red-300",
  })[status];
const cellMetricLabel = (value: number | null, metric: HeatmapMetric) =>
  formatCompact(value, metric).replace(/^\+/, "");
const modelIvLabel = (
  value: number | null,
  metric: "modelMarkIV" | "modelBidIV" | "modelAskIV" | "modelIVSpread"
) => formatCompact(value, metric);

function TooltipPosition({
  position,
  metric,
  ivSource,
  preset,
  content,
}: {
  position: EnrichedRiskPosition;
  metric: HeatmapMetric;
  ivSource: IvValueSource;
  preset: HoverDataPreset;
  content: Props["hoverContent"];
}) {
  const rows: Array<[string, string]> = [];
  if (content.selectedMetric)
    rows.push([
      "Selected metric",
      formatCompact(metricValue(position, metric), metric),
    ]);
  if (preset === "risk" || preset === "all") {
    if (content.qtyNotional) {
      rows.push(["Qty", formatCompact(position.netQty)]);
      rows.push([
        "Notional Size USD",
        `$${formatCompact(position.notionalSizeUSD)}`,
      ]);
    }
    if (content.unitDelta)
      rows.push(["Unit Delta", formatCompact(position.unitDelta, "unitDelta")]);
    if (content.totalDelta)
      rows.push(["Total Delta XAU", formatCompact(position.totalDeltaXAU)]);
    if (content.unitGamma)
      rows.push(["Unit Gamma", formatCompact(position.unitGamma)]);
    if (content.totalGamma)
      rows.push(["Total Gamma XAU", formatCompact(position.totalGammaXAU)]);
    if (content.unitTheta)
      rows.push(["Unit Theta", formatCompact(position.unitTheta)]);
    if (content.totalTheta)
      rows.push([
        "Total Theta USD/day",
        `$${formatCompact(position.totalThetaUSD)}`,
      ]);
    if (content.unitVega)
      rows.push(["Unit Vega", formatCompact(position.unitVega)]);
    if (content.totalVega)
      rows.push([
        "Total Vega USD/vol",
        `$${formatCompact(position.totalVegaUSD)}`,
      ]);
    if (content.dteRoll)
      rows.push([
        "DTE / Roll",
        `${position.dte}d / ${position.rollPriority.total.toFixed(0)}`,
      ]);
  }
  if (preset === "market" || preset === "all") {
    if (content.qtyNotional && preset === "market")
      rows.push(["Qty", formatCompact(position.netQty)]);
    if (content.markIv) {
      rows.push([
        "Mark / Mark IV",
        `${formatPrice(position.markPrice)} ${position.premiumCurrency ?? ""} / ${
          ivSource === "model"
            ? modelIvLabel(position.modelMarkIV, "modelMarkIV")
            : formatCompact(position.markIV, "markIV")
        }`.trim(),
      ]);
    }
    if (content.bidAsk) {
      rows.push([
        "Bid / Ask",
        `${formatPrice(position.bid)} / ${formatPrice(position.ask)} ${position.premiumCurrency ?? ""}`.trim(),
      ]);
      rows.push([
        "Bid / Ask Size",
        `${formatCompact(position.bidSize)} / ${formatCompact(position.askSize)}`,
      ]);
      rows.push([
        "Bid / Ask $ Notional",
        `$${formatCompact(position.bidDollarNotional)} / $${formatCompact(position.askDollarNotional)}`,
      ]);
    }
    if (content.bidAskIv) {
      if (ivSource === "model") {
        rows.push([
          "Bid / Ask IV",
          `${modelIvLabel(position.modelBidIV, "modelBidIV")} / ${modelIvLabel(position.modelAskIV, "modelAskIV")}`,
        ]);
        if (content.ivReferenceSpot) {
          rows.push([
            "IV Reference Spot / As-of",
            `${formatPrice(position.ivReferenceSpot)} / ${position.ivReferenceTime?.slice(0, 19).replace("T", " ") ?? "MISSING"}`,
          ]);
        }
        if (content.modelIvStatus) {
          rows.push([
            "Mark / Bid / Ask IV Status",
            `${position.modelMarkIvStatus} / ${position.modelBidIvStatus} / ${position.modelAskIvStatus}`,
          ]);
        }
      } else {
        rows.push([
          "Bid / Ask IV",
          `${formatCompact(position.bidIV, "bidIV")} / ${formatCompact(position.askIV, "askIV")}`,
        ]);
      }
    }
    if (content.ivSpread) {
      rows.push(
        ivSource === "model"
          ? [
              "Bid Ask IV Spread",
              modelIvLabel(position.modelIVSpread, "modelIVSpread"),
            ]
          : ["Bid Ask IV Spread", formatCompact(position.ivSpread, "ivSpread")]
      );
    }
    if (content.sourceQuote) {
      rows.push([
        "Source / Quote As-of",
        `${position.source ?? "MISSING"} / ${position.quoteTime?.slice(0, 19).replace("T", " ") ?? "MISSING"}`,
      ]);
      if (ivSource === "model" && content.ivReferenceSource) {
        rows.push([
          "IV Reference Source",
          position.ivReferenceSource ?? "MISSING",
        ]);
      }
    }
  }
  if (preset === "pnl" || preset === "all") {
    if (content.qtyNotional && preset === "pnl")
      rows.push(["Qty", formatCompact(position.netQty)]);
    if (content.mvEntry)
      rows.push([
        "MV / Entry",
        `$${formatCompact(position.MV)} / $${formatCompact(position.entryCost)}`,
      ]);
    if (content.upl) rows.push(["UPL", `$${formatCompact(position.UPL)}`]);
  }
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-right font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
}

function SpotPriceTooltip({
  spot,
  children,
}: {
  spot: number;
  children: ReactElement;
}) {
  return (
    <Tooltip delayDuration={80}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={4}
        className="z-[120] border border-amber-300/40 bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-xl"
      >
        <span className="text-muted-foreground">Spot price </span>
        <strong className="font-mono text-amber-300">
          {formatSpotPrice(spot)}
        </strong>
      </TooltipContent>
    </Tooltip>
  );
}

function ExpiryTooltip({
  expiry,
  positions,
  metric,
  detailEnabled,
  onSelectExpiry,
  children,
}: {
  expiry: string;
  positions: EnrichedRiskPosition[];
  metric: HeatmapMetric;
  detailEnabled: boolean;
  onSelectExpiry: Props["onSelectExpiry"];
  children: ReactElement<{ onClick?: MouseEventHandler }>;
}) {
  const distribution = metricDistribution(positions, metric);
  const heldTotal = expiryHeldMetricTotal(positions, metric);
  const heldTotalValue =
    heldTotal === null
      ? null
      : heldTotal.label === "Total Delta"
        ? formatCompact(heldTotal.value, metric)
        : heldTotal.label === "Total Notional Size USD"
          ? `$${formatCompact(heldTotal.value, metric)}`
          : formatCompact(heldTotal.value, metric);
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        {cloneElement(children, {
          onClick: event => {
            children.props.onClick?.(event);
            if (detailEnabled) onSelectExpiry(expiry, positions);
          },
        })}
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={4}
        collisionPadding={10}
        className="z-[110] w-[430px] max-w-[calc(100vw-1rem)] border border-border bg-popover p-2 text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/50 pb-1">
          <strong className="font-mono text-xs">EXPIRY {expiry}</strong>
          <span className="text-[9px] text-primary">
            {METRIC_LABELS[metric]}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-6 gap-px bg-border/60 text-center">
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">MIN</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.min, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">P25</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.p25, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">MEDIAN</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.median, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">AVERAGE</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.average, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">P75</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.p75, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">MAX</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.max, metric)}
            </strong>
          </div>
        </div>
        {heldTotal && (
          <div className="mt-1 flex items-center justify-between border border-primary/25 bg-primary/10 px-2 py-1 text-[10px]">
            <span className="text-muted-foreground">{heldTotal.label}</span>
            <strong className="font-mono text-primary">{heldTotalValue}</strong>
          </div>
        )}
        <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
          <span>
            Valid {distribution.validCount} · Missing{" "}
            {distribution.missingCount}
          </span>
          {detailEnabled && <span>点击查看全面数据</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function HeatmapScopeTooltip({
  positions,
  metric,
  moneyness,
  label,
}: {
  positions: EnrichedRiskPosition[];
  metric: HeatmapMetric;
  moneyness: MoneynessFilter;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const distribution = useMemo(
    () => metricDistribution(positions, metric),
    [metric, positions]
  );
  const markets = useMemo(
    () => [
      ...new Set(
        positions.map(position => {
          if (position.underlying === "GLD") return "GLD/USD-OPRA";
          const deribit = position.venue.toLowerCase().includes("deribit");
          return `${position.underlying}/${deribit ? "USD" : "USDT"} - ${deribit ? "Deribit" : "Bybit"}`;
        })
      ),
    ],
    [positions]
  );
  const scopeLabel =
    markets.length === 1
      ? markets[0]
      : markets.length > 1
        ? "ALL MARKETS"
        : "CURRENT MARKET";
  const optionScopeLabel =
    moneyness === "itm"
      ? "ALL ITM Options"
      : moneyness === "otm"
        ? "ALL OTM Options"
        : "ALL EXPIRIES / STRIKES";
  const eligibilityLabel = HELD_ONLY_HEATMAP_METRICS.has(metric)
    ? "Held positions only"
    : "All filtered option contracts";
  return (
    <Tooltip delayDuration={100} open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="heatmap-scope-summary-trigger"
          aria-label={`Current ${METRIC_LABELS[metric]} summary for all expiries and strikes`}
          className="sticky left-0 top-0 z-30 flex h-8 items-center border-b border-r border-border/60 bg-background px-1 text-[8px] text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent
        data-testid="heatmap-scope-metric-summary"
        side="right"
        sideOffset={6}
        collisionPadding={10}
        className="z-[120] w-[430px] max-w-[calc(100vw-1rem)] border border-border bg-popover p-2 text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/50 pb-1">
          <strong className="font-mono text-xs">
            {scopeLabel} · {optionScopeLabel}
          </strong>
          <span className="text-[9px] text-primary">
            {METRIC_LABELS[metric]}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-6 gap-px bg-border/60 text-center">
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">MIN</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.min, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">P25</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.p25, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">MEDIAN</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.median, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">AVERAGE</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.average, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">P75</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.p75, metric)}
            </strong>
          </div>
          <div className="bg-background p-1.5">
            <p className="text-[8px] text-muted-foreground">MAX</p>
            <strong className="font-mono text-[11px]">
              {formatCompact(distribution.max, metric)}
            </strong>
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground">
          <span>{eligibilityLabel}</span>
          <span>
            Valid {distribution.validCount} · Missing{" "}
            {distribution.missingCount}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function HeatmapGrid({
  cells,
  expiries,
  strikes,
  metric,
  ivSource,
  scale,
  importanceCutoff,
  lowImportanceCutoff,
  transpose,
  reverseStrikes,
  cellSize,
  fitAll,
  spot,
  callPut,
  moneyness,
  atmStrike,
  highlightCellKey,
  labelMode,
  hoverPreset,
  sequentialMagnitude,
  heldCellContent,
  hoverContent,
  cellDetailEnabled,
  expiryDetailEnabled,
  targetMode,
  targetCellKeys,
  onTargetCellChange,
  onSelectPosition,
  onSelectExpiry,
}: Props) {
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const centeredOnceRef = useRef<string | null>(null);
  const range = useMemo(() => spotRangeState(strikes, spot), [spot, strikes]);
  const atmStrikes = useMemo(
    () =>
      new Set(
        atmStrike === undefined
          ? nearestStrikeLevels(strikes, spot)
          : atmStrike === null
            ? []
            : [atmStrike]
      ),
    [atmStrike, spot, strikes]
  );
  const displayStrikes = useMemo(
    () => [...strikes].sort((a, b) => (reverseStrikes ? b - a : a - b)),
    [reverseStrikes, strikes]
  );
  const cellMap = useMemo(
    () => new Map(cells.map(cell => [cell.key, cell])),
    [cells]
  );
  const scopePositions = useMemo(
    () => cells.flatMap(cell => cell.positions),
    [cells]
  );
  const expiryDteByExpiry = useMemo(() => {
    const result = new Map<string, number | null>();
    for (const expiry of expiries) {
      const dte = cells
        .filter(cell => cell.expiry === expiry)
        .flatMap(cell => cell.positions)
        .find(position => Number.isFinite(position.dte))?.dte;
      result.set(expiry, dte ?? null);
    }
    return result;
  }, [cells, expiries]);
  const centered = scale.centered;
  const columnValues = transpose ? displayStrikes : expiries;
  const rowValues = transpose ? expiries : displayStrikes;
  const columnMin = fitAll ? 1 : Math.max(8, Math.round(cellSize * 2.6));
  const axisWidth = fitAll ? 68 : 82;
  const template = `${axisWidth}px repeat(${columnValues.length}, minmax(${columnMin}px, 1fr))`;
  const minWidth = fitAll
    ? 0
    : Math.max(480, axisWidth + columnValues.length * columnMin);
  const rowHeight = fitAll
    ? `max(0.65px, min(${cellSize}px, calc((100vh - 350px) / ${Math.max(1, rowValues.length)})))`
    : `${cellSize}px`;
  const scrollToSpot = (behavior: ScrollBehavior = "smooth") =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const selector = transpose
          ? "[data-spot-column='true']"
          : "[data-spot-row='true']";
        const target = viewport.querySelector<HTMLElement>(selector);
        if (!target) return;

        // Only move the heatmap's own viewport. scrollIntoView() can also scroll page
        // ancestors, which hides the filters just when the initial ATM row is found.
        if (transpose) {
          viewport.scrollTo({
            left: Math.max(
              0,
              target.offsetLeft -
                (viewport.clientWidth - target.offsetWidth) / 2
            ),
            behavior,
          });
          return;
        }
        viewport.scrollTo({
          top: Math.max(
            0,
            target.offsetTop - (viewport.clientHeight - target.offsetHeight) / 2
          ),
          behavior,
        });
      })
    );
  useEffect(() => {
    if (range.nearestStrike === null || !cells.length) return;
    const marker = `${transpose ? "column" : "row"}|${range.nearestStrike}|${cells.length}`;
    if (centeredOnceRef.current === marker) return;
    centeredOnceRef.current = marker;
    scrollToSpot("auto");
  }, [cells.length, range.nearestStrike, transpose]);
  const colorFor = (value: number) => {
    const normalized = scale.normalize(
      sequentialMagnitude ? Math.abs(value) : value
    );
    return sequentialMagnitude
      ? magnitudeHeatColor(normalized)
      : heatColor(normalized, centered);
  };
  const fixedRange = scale.rangeBasis !== "distribution";
  const legendMaximum =
    scale.centered && !fixedRange ? scale.p99Abs : scale.clipHigh;
  const legendMinimum = fixedRange
    ? scale.clipLow
    : scale.centered
      ? -scale.p99Abs
      : 0;
  const legendMidpoint = (legendMinimum + legendMaximum) / 2;
  const legendGradient =
    "linear-gradient(to top, rgb(22 163 74), rgb(250 204 21), rgb(239 68 68))";

  return (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden border border-border/60 bg-background/70"
      data-testid="risk-heatmap-grid"
    >
      <div ref={viewportRef} className="min-w-0 flex-1 overflow-auto">
        <div
          style={
            {
              display: "grid",
              gridTemplateColumns: template,
              minWidth,
            } as CSSProperties
          }
        >
          <HeatmapScopeTooltip
            positions={scopePositions}
            metric={metric}
            moneyness={moneyness}
            label={transpose ? "EXP / STRIKE" : "STRIKE / EXP"}
          />
          {columnValues.map(column => {
            const strikeColumn = transpose ? Number(column) : null;
            const isSpotColumn =
              strikeColumn !== null && range.nearestStrike === strikeColumn;
            const isAtmColumn =
              strikeColumn !== null && atmStrikes.has(strikeColumn);
            const expiryDte = !transpose
              ? (expiryDteByExpiry.get(String(column)) ?? null)
              : null;
            const label = (
              <button
                type="button"
                data-expiry-header={!transpose ? String(column) : undefined}
                aria-label={
                  !transpose
                    ? `Expiry ${String(column)} · DTE ${expiryDte ?? "MISSING"} days summary`
                    : undefined
                }
                data-spot-column={isSpotColumn ? "true" : undefined}
                className={`sticky top-0 z-20 flex h-8 flex-col items-center justify-center truncate border-b border-r border-border/40 bg-background px-0.5 font-mono text-[8px] leading-none ${isSpotColumn ? "border-x-amber-300/70 text-amber-300" : "text-foreground/75"}`}
                title={
                  transpose
                    ? `Strike ${formatStrike(strikeColumn)} · ${formatStrikeDistanceFromSpot(strikeColumn!, spot)} vs spot`
                    : `${String(column)} · DTE ${expiryDte ?? "MISSING"} days`
                }
              >
                {transpose ? (
                  <>
                    {formatStrike(strikeColumn)}
                    {isAtmColumn ? " · ATM" : ""}
                  </>
                ) : (
                  <>
                    <span>{String(column).slice(5)}</span>
                    <strong className="mt-0.5 text-[7px] text-amber-300">
                      DTE {expiryDte ?? "?"}
                    </strong>
                  </>
                )}
              </button>
            );
            return transpose ? (
              <div key={String(column)} className="contents">
                {isSpotColumn ? (
                  <SpotPriceTooltip spot={spot}>{label}</SpotPriceTooltip>
                ) : (
                  label
                )}
              </div>
            ) : (
              <ExpiryTooltip
                key={String(column)}
                expiry={String(column)}
                positions={cells
                  .filter(cell => cell.expiry === String(column))
                  .flatMap(cell => cell.positions)}
                metric={metric}
                detailEnabled={expiryDetailEnabled}
                onSelectExpiry={onSelectExpiry}
              >
                {label}
              </ExpiryTooltip>
            );
          })}
          {rowValues.flatMap(row => {
            const rowStrike = transpose ? null : Number(row);
            const isSpotRow =
              rowStrike !== null && range.nearestStrike === rowStrike;
            const strikeDistance =
              rowStrike === null
                ? null
                : formatStrikeDistanceFromSpot(rowStrike, spot);
            const rowExpiryDte = transpose
              ? (expiryDteByExpiry.get(String(row)) ?? null)
              : null;
            const axisLabel = (
              <button
                type="button"
                data-expiry-header={transpose ? String(row) : undefined}
                aria-label={
                  transpose
                    ? `Expiry ${String(row)} · DTE ${rowExpiryDte ?? "MISSING"} days summary`
                    : undefined
                }
                data-spot-row={isSpotRow ? "true" : undefined}
                title={
                  rowStrike === null
                    ? `${String(row)} · DTE ${rowExpiryDte ?? "MISSING"} days`
                    : `Strike ${formatStrike(rowStrike)} · ${strikeDistance} vs spot`
                }
                style={{ height: rowHeight }}
                className={`sticky left-0 z-10 flex items-center justify-between overflow-hidden border-b border-r bg-background px-1 font-mono text-[8px] ${isSpotRow ? "border-y-amber-300/80 bg-amber-400/10 text-amber-300" : "border-border/40 text-foreground/75"}`}
              >
                <span>
                  {transpose ? String(row).slice(5) : formatStrike(rowStrike)}
                </span>
                {transpose ? (
                  <strong className="text-[7px] text-amber-300">
                    DTE {rowExpiryDte ?? "?"}
                  </strong>
                ) : (
                  strikeDistance !== null && (
                    <span className="text-[7px]">{strikeDistance}</span>
                  )
                )}
              </button>
            );
            const axis = transpose ? (
              <ExpiryTooltip
                key={`axis-${String(row)}`}
                expiry={String(row)}
                positions={cells
                  .filter(cell => cell.expiry === String(row))
                  .flatMap(cell => cell.positions)}
                metric={metric}
                detailEnabled={expiryDetailEnabled}
                onSelectExpiry={onSelectExpiry}
              >
                {axisLabel}
              </ExpiryTooltip>
            ) : (
              <div key={`axis-${String(row)}`} className="contents">
                {isSpotRow ? (
                  <SpotPriceTooltip spot={spot}>{axisLabel}</SpotPriceTooltip>
                ) : (
                  axisLabel
                )}
              </div>
            );
            const buttons = columnValues.map(column => {
              const expiry = transpose ? String(row) : String(column);
              const strike = transpose ? Number(column) : Number(row);
              const key = `${expiry}|${strike}`;
              const cell = cellMap.get(key);
              const status = cell ? worstStatus(cell.positions) : "LIVE";
              const important =
                cell?.value != null &&
                (Math.abs(cell.value) >= importanceCutoff ||
                  key === highlightCellKey);
              const lowImportance =
                cell?.value != null &&
                Math.abs(cell.value) <= lowImportanceCutoff;
              const showLabel =
                cell &&
                cell.value !== null &&
                (labelMode === "all" ||
                  (labelMode === "held" && cell.held) ||
                  (labelMode === "top" && important) ||
                  (labelMode === "bottom" && lowImportance));
              const topPositions = cell
                ? [...cell.positions].sort(
                    (a, b) =>
                      Math.abs(metricValue(b, metric) ?? 0) -
                      Math.abs(metricValue(a, metric) ?? 0)
                  )
                : [];
              const heldUnderlyings = new Set(
                cell?.positions
                  .filter(position => position.positionKind !== "listed")
                  .map(position => position.underlying) ?? []
              );
              const heldMarker =
                heldUnderlyings.size > 1
                  ? "M"
                  : heldUnderlyings.has("XAUT")
                    ? "X"
                    : heldUnderlyings.has("GLD")
                      ? "G"
                      : heldUnderlyings.has("BTC")
                        ? "B"
                        : heldUnderlyings.has("ETH")
                          ? "E"
                          : null;
              const xautHeld = heldUnderlyings.has("XAUT");
              const heldCallPuts = new Set(
                cell?.positions
                  .filter(position => position.positionKind !== "listed")
                  .map(position => position.callPut) ?? []
              );
              const heldCallPutMarker =
                heldCallPuts.size > 1
                  ? "C/P"
                  : heldCallPuts.has("call")
                    ? "C"
                    : heldCallPuts.has("put")
                      ? "P"
                      : null;
              const heldStatusMarker = cell?.held
                ? heldStatusAbbreviation(status)
                : null;
              const heldMarkerVisible = Boolean(
                cell?.held &&
                  ((heldCellContent.underlying && heldMarker) ||
                    (heldCellContent.callPut && heldCallPutMarker) ||
                    (heldCellContent.dataStatus && heldStatusMarker))
              );
              const spotLine = range.nearestStrike === strike;
              const targetSelected = targetCellKeys.has(key);
              const cellMetricText =
                cell?.ungradedReason === "zero"
                  ? "0.000 uncolored"
                  : formatCompact(cell?.value ?? null, metric);
              return (
                <Tooltip
                  key={key}
                  delayDuration={80}
                  open={hoveredCellKey === key}
                  onOpenChange={open => setHoveredCellKey(open ? key : null)}
                >
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-cell-key={key}
                      data-held={cell?.held ? "true" : "false"}
                      data-xaut-held={xautHeld ? "true" : "false"}
                      data-target-selected={targetSelected ? "true" : "false"}
                      data-metric-missing={
                        cell?.ungradedReason === "missing" ? "true" : "false"
                      }
                      data-metric-zero={
                        cell?.ungradedReason === "zero" ? "true" : "false"
                      }
                      className={`relative overflow-hidden border border-solid px-0.5 text-center font-mono text-[7px] transition-[filter,outline] hover:z-10 hover:brightness-125 focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-primary ${targetMode !== "idle" && cell ? "cursor-crosshair" : ""} ${cell?.value == null ? "" : zoneClass[zoneFor(strike, spot, callPut, atmStrikes)]} ${cell ? "border-cyan-300/45" : "border-border/[0.07] opacity-30"} ${cell?.held ? "z-[3] border-white" : ""} ${key === highlightCellKey ? "z-10 animate-pulse ring-2 ring-white/90" : ""} ${spotLine ? "border-y-amber-300/70" : ""}`}
                      style={{
                        height: rowHeight,
                        containerType: "size",
                        ...(cell?.value == null
                          ? {}
                          : { backgroundColor: colorFor(cell.value) }),
                      }}
                      onClick={() => {
                        if (cell && targetMode !== "idle") {
                          onTargetCellChange(key, targetMode === "add");
                          return;
                        }
                        if (cellDetailEnabled && topPositions[0])
                          onSelectPosition(topPositions[0]);
                      }}
                      onMouseEnter={() => cell && setHoveredCellKey(key)}
                      onMouseLeave={() =>
                        setHoveredCellKey(current =>
                          current === key ? null : current
                        )
                      }
                      onFocus={() => cell && setHoveredCellKey(key)}
                      onBlur={() =>
                        setHoveredCellKey(current =>
                          current === key ? null : current
                        )
                      }
                      aria-label={
                        cell
                          ? `${key} ${cellMetricText} ${cell.held ? "held" : "listed no position"} ${status}${targetSelected ? " target selected" : ""}`
                          : `${key} unavailable not listed`
                      }
                    >
                      {xautHeld && (
                        <span
                          data-xaut-held-border="true"
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-[1] border-solid border-amber-300"
                          style={{
                            borderWidth: "clamp(1px, min(7cqi, 22cqh), 3px)",
                          }}
                        />
                      )}
                      {targetSelected && (
                        <span
                          data-target-border="true"
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-px z-[4] border border-violet-300"
                        />
                      )}
                      {showLabel && (
                        <span
                          title={formatCompact(cell!.value, metric)}
                          className="relative z-[2] block max-w-full truncate pl-px font-semibold leading-none text-white drop-shadow-sm"
                          style={{
                            paddingRight: heldMarkerVisible ? "38%" : "1px",
                            fontSize: "clamp(4px, min(28cqi, 65cqh), 11px)",
                          }}
                        >
                          {cellMetricLabel(cell!.value, metric)}
                        </span>
                      )}
                      {heldMarkerVisible && (
                        <span
                          data-held-marker="true"
                          aria-hidden="true"
                          title="持仓合约识别码"
                          className="pointer-events-none absolute right-[3%] top-1/2 z-[2] flex -translate-y-1/2 gap-px font-mono font-black leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
                          style={{
                            fontSize: "clamp(4px, min(15cqi, 50cqh), 8px)",
                          }}
                        >
                          {heldCellContent.underlying && heldMarker && (
                            <span className="text-amber-100">{heldMarker}</span>
                          )}
                          {heldCellContent.callPut && heldCallPutMarker && (
                            <span className="text-sky-100">
                              {heldCallPutMarker}
                            </span>
                          )}
                          {heldCellContent.dataStatus && heldStatusMarker && (
                            <span className={heldStatusColor(status)}>
                              {heldStatusMarker}
                            </span>
                          )}
                        </span>
                      )}
                      {cell &&
                        cell.positions.length > 1 &&
                        labelMode !== "none" && (
                          <span className="absolute bottom-0 left-0 z-[2] text-[5px] leading-none text-white/60">
                            {cell.positions.length}
                          </span>
                        )}
                    </button>
                  </TooltipTrigger>
                  {cell && (
                    <TooltipContent
                      side="right"
                      sideOffset={6}
                      collisionPadding={12}
                      className="z-[100] w-80 border border-border bg-popover p-2 text-popover-foreground shadow-2xl"
                    >
                      <div className="flex items-center justify-between border-b border-border/50 pb-1">
                        <strong className="font-mono text-xs">
                          {expiry} · {formatStrike(strike)}
                        </strong>
                        <span className="text-[9px] text-muted-foreground">
                          {targetSelected ? "TARGET · " : ""}
                          {cell.held
                            ? "HELD POSITION"
                            : "LISTED / NO POSITION"}{" "}
                          · {status}
                        </span>
                      </div>
                      <div className="mt-1 rounded-sm bg-primary/10 px-2 py-1 text-[10px]">
                        <span className="text-muted-foreground">
                          Cell {METRIC_LABELS[metric]}{" "}
                        </span>
                        <strong className="float-right font-mono text-primary">
                          {cell.ungradedReason === "zero"
                            ? "ZERO · NOT COLORED"
                            : cell.value === null
                              ? "MISSING · NOT COLORED"
                              : formatCompact(cell.value, metric)}
                        </strong>
                      </div>
                      <div className="mt-1 space-y-2">
                        {topPositions.slice(0, 5).map(position => (
                          <div key={position.id}>
                            <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                              <span className="truncate font-medium">
                                {positionLabel(position)} · {position.account}
                              </span>
                              <span className="font-mono">
                                {formatCompact(
                                  metricValue(position, metric),
                                  metric
                                )}
                              </span>
                            </div>
                            <TooltipPosition
                              position={position}
                              metric={metric}
                              ivSource={ivSource}
                              preset={hoverPreset}
                              content={hoverContent}
                            />
                          </div>
                        ))}
                      </div>
                      {targetMode !== "idle" && (
                        <p className="mt-2 border-t border-border/50 pt-1 text-[9px] text-violet-300">
                          点击将{targetMode === "add" ? "选中" : "取消选中"}此
                          Target Option
                        </p>
                      )}
                      {targetMode === "idle" && cellDetailEnabled && (
                        <p className="mt-2 border-t border-border/50 pt-1 text-[9px] text-muted-foreground">
                          点击查看完整行情、数据质量与已选择的详情字段
                        </p>
                      )}
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            });
            return [axis, ...buttons];
          })}
        </div>
      </div>
      <aside
        className="flex w-[62px] shrink-0 flex-col items-center border-l border-border/60 bg-card/50 px-1 py-2"
        aria-label="vertical heatmap legend"
      >
        <span className="text-center text-[7px] uppercase leading-tight text-muted-foreground">
          {sequentialMagnitude
            ? "ABS VALUE"
            : scale.centered
              ? "SIGNED"
              : "RAW VALUE"}
          <br />
          {scale.rangeBasis === "held"
            ? "HELD RANGE"
            : scale.custom
              ? "CUSTOM"
              : "P99 CLIP"}
        </span>
        <span className="mt-1 font-mono text-[7px] text-foreground">
          {formatCompact(legendMaximum, metric)}
        </span>
        <div
          className="my-1 min-h-16 w-3 flex-1 border border-white/10"
          style={{ background: legendGradient }}
        />
        <span className="font-mono text-[7px] text-yellow-300">
          {formatCompact(legendMidpoint, metric)}
        </span>
        <span className="mt-auto font-mono text-[7px] text-emerald-300">
          {formatCompact(legendMinimum, metric)}
        </span>
        <span className="mt-1 text-center text-[6px] leading-tight text-cyan-200">
          THIN CYAN
          <br />
          LISTED
        </span>
        <span className="mt-1 text-center text-[6px] font-semibold leading-tight text-white">
          WHITE
          <br />
          HELD
        </span>
        {(heldCellContent.underlying || heldCellContent.callPut) && (
          <span className="mt-1 text-center font-mono text-[6px] font-bold leading-tight text-amber-100">
            X/G · C/P
            <br />
            CONTRACT
          </span>
        )}
        {heldCellContent.dataStatus && (
          <span className="mt-1 text-center font-mono text-[6px] leading-tight text-muted-foreground">
            L/S/W/M/F
            <br />
            HELD DATA
          </span>
        )}
        {targetCellKeys.size > 0 && (
          <span className="mt-1 text-center text-[6px] font-semibold leading-tight text-violet-300">
            VIOLET
            <br />
            TARGET
          </span>
        )}
      </aside>
    </div>
  );
}
