import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import { recordMarketRefreshAt, readLastMarketRefreshAt } from "@/lib/marketRefreshStatus";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef } from "react";

/** Runs while the site is open. A server-side scheduler is still recommended for 24/7 refreshes. */
export function AutoMarketRefresh() {
  const { settings } = usePortfolioSettings();
  const utils = trpc.useUtils();
  const refresh = trpc.positions.refreshMarketData.useMutation();
  const running = useRef(false);
  const refreshRef = useRef(refresh);
  const utilsRef = useRef(utils);
  refreshRef.current = refresh;
  utilsRef.current = utils;

  useEffect(() => {
    if (!settings.marketAutoRefreshEnabled) return;
    const intervalMs = Math.max(1, settings.marketAutoRefreshMinutes) * 60_000;
    let disposed = false;
    const tick = async () => {
      const last = readLastMarketRefreshAt();
      if (last && Date.now() - Date.parse(last) < intervalMs) return;
      if (running.current || disposed) return;
      running.current = true;
      try {
        const result = await refreshRef.current.mutateAsync({
          gldMultiplierXau: settings.gldSpotScaleOverride,
          xautMultiplierXau: settings.xautSpotScaleOverride,
        });
        recordMarketRefreshAt(result.refreshedAt);
        await utilsRef.current.invalidate();
      } catch (error) {
        console.warn("[AutoMarketRefresh] refresh failed", error);
      } finally {
        running.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), Math.min(intervalMs, 60_000));
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [settings.gldSpotScaleOverride, settings.marketAutoRefreshEnabled, settings.marketAutoRefreshMinutes, settings.xautSpotScaleOverride]);

  return null;
}
