import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import { recordMarketRefreshAt } from "@/lib/marketRefreshStatus";

export function MarketRefreshButton({ compact = false }: { compact?: boolean }) {
  const utils = trpc.useUtils();
  const { settings } = usePortfolioSettings();
  const refresh = trpc.positions.refreshMarketData.useMutation({
    onSuccess: async result => {
      recordMarketRefreshAt(result.refreshedAt);
      await utils.invalidate();
      const missing = result.missing.length ? `，${result.missing.length} 条未匹配` : "";
      toast.success(`市场数据已更新 ${result.updated}/${result.total}${missing}`);
    },
    onError: error => toast.error(`刷新失败：${error.message}`),
  });
  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "sm" : "default"}
      className="gap-1.5 whitespace-nowrap border-primary/40 text-primary"
      onClick={() => refresh.mutate({ gldMultiplierXau: settings.gldSpotScaleOverride, xautMultiplierXau: settings.xautSpotScaleOverride, btcMultiplierXau: settings.btcSpotScaleOverride })}
      disabled={refresh.isPending}
      title="联网刷新每条持仓的 Mark、IV、Bid/Ask、Unit/Total Greeks、MV 与 UPL，并持久化到下次 Excel 导出"
      data-testid="refresh-market-data"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
      {compact ? (refresh.isPending ? "更新中" : "更新市场数据") : (refresh.isPending ? "正在读取行情…" : "联网更新全部市场数据")}
    </Button>
  );
}
