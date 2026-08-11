import type { DataStatus } from "@shared/riskHeatmap";

export type DecisionCardModel = {
  key: string;
  label: string;
  value: string;
  detail: string;
  status: DataStatus;
  targetCellKey: string | null;
};

const statusClass: Record<DataStatus, string> = {
  LIVE: "border-sky-500/30",
  STALE: "border-amber-500/60",
  WARN: "border-amber-400/50",
  MISSING: "border-orange-500/70",
  FAIL: "border-red-500/80",
};

export function DecisionCards({ cards, onLocate }: { cards: DecisionCardModel[]; onLocate: (cellKey: string) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1" aria-label="关键风险定位卡">
      {cards.map(card => (
        <button
          type="button"
          key={card.key}
          className={`min-w-0 border bg-card/70 px-2 py-1.5 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${statusClass[card.status]}`}
          onClick={() => card.targetCellKey && onLocate(card.targetCellKey)}
          disabled={!card.targetCellKey}
          title={`${card.label}: ${card.value} · ${card.detail}`}
        >
          <span className="block truncate text-[9px] uppercase tracking-[0.08em] text-muted-foreground">{card.label}</span>
          <strong className="mt-0.5 block truncate font-mono text-[13px] leading-none text-foreground">{card.value}</strong>
          <span className="mt-1 block truncate text-[9px] leading-none text-muted-foreground">{card.detail}</span>
        </button>
      ))}
    </div>
  );
}
