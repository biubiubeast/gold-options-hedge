import {
  calculateScenario,
  exerciseControl,
  formatCompact,
  type EnrichedRiskPosition,
  type RiskUnderlying,
} from "@shared/riskHeatmap";
import { useMemo, useState } from "react";

const statusClass = {
  LIVE: "border-sky-500/30 text-sky-200",
  STALE: "border-amber-400/60 text-amber-200",
  WARN: "border-amber-400/60 text-amber-200",
  MISSING: "border-orange-500/70 text-orange-200",
  FAIL: "border-red-500/80 bg-red-500/10 text-red-200",
} as const;

export function ExpiryPanel({ positions, gldSpot }: { positions: EnrichedRiskPosition[]; gldSpot: number }) {
  const controls = useMemo(() => positions
    .filter(position => position.underlying === "GLD" && position.dte <= 2)
    .map(position => exerciseControl(position, gldSpot))
    .sort((a, b) => {
      const severity = { FAIL: 4, MISSING: 3, STALE: 2, WARN: 1, LIVE: 0 } as const;
      return severity[b.status] - severity[a.status] || a.dte - b.dte;
    }), [gldSpot, positions]);
  if (controls.length === 0) return null;
  const control = controls[0];
  return (
    <section className={`grid min-h-12 grid-cols-[auto_repeat(7,minmax(0,1fr))] items-center gap-x-3 border px-2 py-1 text-[9px] ${statusClass[control.status]}`} aria-label="GLD expiry control panel">
      <div className="border-r border-current/20 pr-3">
        <strong className="block text-[10px]">EXPIRY {control.status}</strong>
        <span className="font-mono">{control.label}</span>
        {controls.length > 1 && <span className="ml-1 text-muted-foreground">+{controls.length - 1}</span>}
      </div>
      <Metric label="DTE / DIST" value={`${control.dte}d / ${control.spotDistancePct === null ? "MISSING" : `${control.spotDistancePct.toFixed(2)}%`}`} />
      <Metric label="FUNDING" value={formatUsd(control.estimatedFundingUSD)} />
      <Metric label="USD / BP" value={formatUsd(control.availableFundingUSD)} />
      <Metric label="COVERAGE" value={control.fundingCoveragePct === null ? "MISSING" : `${control.fundingCoveragePct.toFixed(0)}%`} />
      <Metric label="CUTOFF" value={control.brokerCutoff ?? "MISSING"} />
      <Metric label="ACTION" value={control.plannedAction} />
      <Metric label="OWNER / REVIEW" value={`${control.owner ?? "MISSING"} / ${control.reviewer ?? "MISSING"} · ${control.confirmationId ?? "NO CONFIRM"}`} />
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><span className="block truncate text-[8px] uppercase text-muted-foreground">{label}</span><strong className="block truncate font-mono text-[9px] text-current">{value}</strong></div>;
}

function formatUsd(value: number | null) {
  return value === null ? "MISSING" : `$${formatCompact(value)}`;
}

export function ScenarioStrip({ positions, spots }: {
  positions: EnrichedRiskPosition[];
  spots: Record<RiskUnderlying, number> & { XAU: number };
}) {
  const [xauShockPct, setXauShockPct] = useState(-10);
  const [ivShockPoints, setIvShockPoints] = useState(5);
  const [day, setDay] = useState<0 | 1 | 3 | 7>(3);
  const [vanNakedDeltaXau, setVanNakedDeltaXau] = useState(120);
  const result = useMemo(() => calculateScenario(positions, { xauShockPct, ivShockPoints, day, vanNakedDeltaXau, spots }), [day, ivShockPoints, positions, spots, vanNakedDeltaXau, xauShockPct]);
  return (
    <section className="grid min-h-11 grid-cols-[minmax(210px,1.4fr)_repeat(6,minmax(78px,1fr))] items-center gap-2 border border-border/60 bg-card/45 px-2 py-1 text-[9px]" aria-label="scenario analysis">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <label className="font-medium text-foreground">XAU Shock</label>
        <input aria-label="XAU Shock" type="range" min={-20} max={20} step={1} value={xauShockPct} onChange={event => setXauShockPct(Number(event.target.value))} className="h-1 accent-amber-400" />
        <strong className="w-9 text-right font-mono">{xauShockPct > 0 ? "+" : ""}{xauShockPct}%</strong>
      </div>
      <label className="grid grid-cols-[auto_1fr] items-center gap-1 text-muted-foreground">IV
        <select aria-label="IV Shock" value={ivShockPoints} onChange={event => setIvShockPoints(Number(event.target.value))} className="h-6 border border-border bg-background px-1 font-mono text-foreground">
          {[-10, -5, 0, 5, 10].map(value => <option key={value} value={value}>{value > 0 ? "+" : ""}{value}v</option>)}
        </select>
      </label>
      <label className="grid grid-cols-[auto_1fr] items-center gap-1 text-muted-foreground">Day
        <select aria-label="Scenario Day" value={day} onChange={event => setDay(Number(event.target.value) as 0 | 1 | 3 | 7)} className="h-6 border border-border bg-background px-1 font-mono text-foreground">
          {[0, 1, 3, 7].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="grid grid-cols-[auto_1fr] items-center gap-1 text-muted-foreground">Van Δ
        <input aria-label="Van Naked Delta XAU" type="number" value={vanNakedDeltaXau} onChange={event => setVanNakedDeltaXau(Number(event.target.value))} className="h-6 min-w-0 border border-border bg-background px-1 font-mono text-foreground" />
      </label>
      <Metric label="OPTION PNL" value={`$${formatCompact(result.optionPnlUSD)}`} />
      <Metric label="VAN NAKED PNL" value={`$${formatCompact(result.vanNakedPnlUSD)}`} />
      <Metric label="RESIDUAL / COVER" value={`$${formatCompact(result.residualPnlUSD)} / ${result.stressCoveragePct === null ? "N/A" : `${result.stressCoveragePct.toFixed(0)}%`}${result.missingCount ? ` · M${result.missingCount}` : ""}`} />
    </section>
  );
}
