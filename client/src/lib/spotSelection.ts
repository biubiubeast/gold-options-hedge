import type { SpotPrice } from "@shared/marketTypes";

type SpotBundle = {
  xaut?: SpotPrice | null;
  gld?: SpotPrice | null;
  gold?: SpotPrice | null;
  btc?: SpotPrice | null;
};

type ChainSpotFallbacks = {
  xaut?: number | null;
  gld?: number | null;
  btc?: number | null;
};

function firstPositive(...values: Array<number | null | undefined>): number {
  return values.find(value => typeof value === "number" && Number.isFinite(value) && value > 0) ?? 0;
}

/**
 * Keep the global header and the heatmap on one canonical spot snapshot.
 * Chain-embedded spots are only fallbacks because their source, timestamp and
 * cache window can differ from market.spotPrices.
 */
export function resolveHeatmapSpots(
  spotPrices: SpotBundle | undefined,
  chainSpots: ChainSpotFallbacks = {},
) {
  return {
    xaut: firstPositive(spotPrices?.xaut?.price, chainSpots.xaut),
    gld: firstPositive(spotPrices?.gld?.price, chainSpots.gld),
    btc: firstPositive(spotPrices?.btc?.price, chainSpots.btc),
    xau: firstPositive(spotPrices?.gold?.price, spotPrices?.xaut?.price),
  };
}
