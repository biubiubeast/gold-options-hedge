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
      title="联网刷新 Mark、IV、Bid/Ask 和 Unit Greeks，再按公式管理中的 GLD/XAUT XAU 量纲、每张合约规格与 Total Greeks 公式重算并写入服务器，供页面和 Excel 导出使用"
      data-testid="refresh-market-data"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
      {compact ? (refresh.isPending ? "更新中" : "更新市场数据") : (refresh.isPending ? "正在读取行情…" : "联网更新全部市场数据")}
    </Button>
  );
}
