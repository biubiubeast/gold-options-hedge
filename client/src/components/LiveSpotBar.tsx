import { Button } from "@/components/ui/button";
import { MARKET_QUERY_OPTIONS } from "@/lib/marketPolling";
import { trpc } from "@/lib/trpc";
import type { SpotPrice } from "@shared/marketTypes";
import { RefreshCw } from "lucide-react";

const price = (value?: number) => value && value > 0
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  : "—";

function freshness(value?: SpotPrice | null) {
  if (!value) return { label: "等待", className: "bg-muted-foreground" };
  if (value.status === "realtime") return { label: "实时", className: "bg-emerald-400" };
  if (value.status === "stale" || value.stale) return { label: "旧值/休市", className: "bg-amber-500" };
  return { label: "延迟/休市", className: "bg-amber-400" };
}

function SpotChip({ label, value }: { label: string; value?: SpotPrice | null }) {
  const state = freshness(value);
  const timestamp = value?.timestamp
    ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value.timestamp)
    : "等待行情";

  return (
    <div
      className="flex h-9 items-center gap-2 rounded-md border border-border/60 bg-card/60 px-2.5"
      title={`${value?.source || "等待数据源"} · ${timestamp} · ${state.label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${state.className}`} aria-hidden="true" />
      <span className="text-[10px] font-medium text-muted-foreground sm:text-xs">{label}</span>
      <strong className="font-mono text-xs font-semibold tabular-nums sm:text-sm">${price(value?.price)}</strong>
      <span className="hidden text-[9px] text-muted-foreground 2xl:inline">{state.label}</span>
    </div>
  );
}

export function LiveSpotBar() {
  const { data, isFetching, refetch } = trpc.market.spotPrices.useQuery(undefined, MARKET_QUERY_OPTIONS);

  return (
    <div className="flex items-center gap-1.5" aria-label="实时现价">
      <SpotChip label="XAUT/USDT" value={data?.xaut} />
      <SpotChip label="GLD/USD" value={data?.gld} />
      <SpotChip label="BTC/USDT" value={data?.btc} />
      <SpotChip label="ETH/USDT" value={data?.eth} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="hidden h-8 w-8 lg:inline-flex"
        onClick={() => refetch()}
        disabled={isFetching}
        title="立即刷新现价"
        aria-label="立即刷新现价"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
