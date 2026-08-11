import {
  calculatePosition,
  type MarketSnapshot,
  type PortfolioPosition,
  type PortfolioSettings,
} from "@/lib/portfolio";
import { finiteOrNull, type DataStatus, type RiskPosition } from "@shared/riskHeatmap";
import type { FormulaLike } from "@shared/marketTypes";

export type LivePositionView = {
  position: PortfolioPosition;
  market: MarketSnapshot;
};

function fallbackStatus(market: MarketSnapshot): DataStatus {
  if (!market.available) return "MISSING";
  if (market.dataStatus === "STALE") return "STALE";
  if (market.estimated) return "WARN";
  return market.dataStatus;
}
export function buildLiveRiskPositions(args: {
  views: LivePositionView[];
  spots: { xaut: number; gld: number; xau: number };
  settings: PortfolioSettings;
  formulas?: readonly FormulaLike[];
}): RiskPosition[] {
  const { spots, settings } = args;
  return args.views.map(({ position, market }) => {
    const calculated = calculatePosition({
      position,
      market,
      xautSpot: spots.xaut,
      gldSpot: spots.gld,
      xauSpot: spots.xau,
      formulas: args.formulas,
      settings,
    });
    const multiplier = position.underlying === "GLD"
      ? settings.gldContractMultiplier
      : settings.xautContractMultiplier;
    const ounces = position.underlying === "GLD"
      ? settings.gldSpotScaleOverride ?? (spots.xau > 0 && spots.gld > 0 ? spots.gld / spots.xau : null)
      : settings.xautSpotScaleOverride ?? (spots.xau > 0 && spots.xaut > 0 ? spots.xaut / spots.xau : null);
    const positionTime = position.updatedAt instanceof Date
      ? position.updatedAt.toISOString()
      : typeof position.updatedAt === "string" ? position.updatedAt : null;
    const riskPosition: RiskPosition = {
      id: String(position.id),
      venue: position.underlying === "XAUT" ? "Bybit" : "OPRA",
      broker: "Manual fallback",
      account: "LOCAL-HEDGE",
      underlying: position.underlying,
      instrument: `${position.underlying}-${position.expiry.replaceAll("-", "")}-${position.strike}-${position.optionType === "call" ? "C" : "P"}`,
      callPut: position.optionType,
      expiry: position.expiry,
      strike: Number(position.strike),
      netQty: Number(position.quantity),
      contractMultiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null,
      deliverableSource: "fallback account setting · contract master not connected",
      contractAdjusted: false,
      gldOzPerShare: position.underlying === "GLD" ? finiteOrNull(ounces) : null,
      underlyingOzPerUnit: position.underlying === "XAUT" ? finiteOrNull(ounces) : null,
      markPrice: market.available ? finiteOrNull(market.markPrice) : null,
      bid: market.bid1 > 0 ? market.bid1 : null,
      ask: market.ask1 > 0 ? market.ask1 : null,
      markIV: market.markIv > 0 ? market.markIv : null,
      unitDelta: finiteOrNull(market.delta),
      unitGamma: market.available ? finiteOrNull(market.gamma) : null,
      unitTheta: market.available ? finiteOrNull(market.theta) : null,
      unitVega: market.available ? finiteOrNull(market.vega) : null,
      totalDeltaXAU: finiteOrNull(calculated.totalDeltaXau),
      totalGammaXAU: finiteOrNull(calculated.totalGammaXau),
      totalThetaUSD: finiteOrNull(calculated.totalTheta),
      totalVegaUSD: finiteOrNull(calculated.totalVega),
      MV: market.available ? finiteOrNull(calculated.currentValue) : null,
      entryCost: finiteOrNull(calculated.entryCost),
      UPL: market.available ? finiteOrNull(calculated.pnl) : null,
      quoteTime: market.quoteTime,
      positionTime,
      source: market.source || null,
      dataStatus: fallbackStatus(market),
      availableUSD: null,
      buyingPower: null,
      officialClose: position.underlying === "GLD" ? finiteOrNull(spots.gld) : null,
      brokerCutoff: null,
      plannedAction: null,
      owner: null,
      reviewer: null,
      confirmationId: null,
    };
    return riskPosition;
  });
}
