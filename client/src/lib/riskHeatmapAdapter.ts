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
  spots: { xaut: number; gld: number; btc: number; xau: number };
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
      btcSpot: spots.btc,
      xauSpot: spots.xau,
      formulas: args.formulas,
      settings,
    });
    const importedMultiplier = finiteOrNull(position.contractMultiplier);
    const multiplier = importedMultiplier ?? (position.underlying === "GLD"
      ? settings.gldContractMultiplier
      : position.underlying === "BTC" ? settings.btcContractMultiplier : settings.xautContractMultiplier);
    const importedOunces = finiteOrNull(position.multiplierXau);
    const ounces = importedOunces ?? (position.underlying === "GLD"
      ? settings.gldSpotScaleOverride ?? (spots.xau > 0 && spots.gld > 0 ? spots.gld / spots.xau : null)
      : position.underlying === "BTC"
        ? settings.btcSpotScaleOverride ?? (spots.xau > 0 && spots.btc > 0 ? spots.btc / spots.xau : null)
        : settings.xautSpotScaleOverride ?? (spots.xau > 0 && spots.xaut > 0 ? spots.xaut / spots.xau : null));
    const positionTime = position.referenceDate
      ? `${position.referenceDate}T23:59:59.000Z`
      : position.updatedAt instanceof Date
      ? position.updatedAt.toISOString()
      : typeof position.updatedAt === "string" ? position.updatedAt : null;
    const riskPosition: RiskPosition = {
      id: String(position.id),
      venue: position.venue || (position.underlying === "GLD" ? "OPRA" : "Bybit"),
      broker: position.venue || (position.underlying === "GLD" ? "Manual fallback" : "SignalPlus / Bybit"),
      account: position.sourceAccount || "LOCAL-HEDGE",
      underlying: position.underlying,
      instrument: position.instrument || `${position.underlying}-${position.expiry.replaceAll("-", "")}-${position.strike}-${position.optionType === "call" ? "C" : "P"}`,
      callPut: position.optionType,
      expiry: position.expiry,
      strike: Number(position.strike),
      netQty: Number(position.quantity),
      contractMultiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null,
      deliverableSource: importedMultiplier !== null
        ? `Excel imported · ${position.importSource ?? "position snapshot"}`
        : "fallback account setting · contract master not connected",
      contractAdjusted: position.underlying === "GLD" && importedMultiplier !== null && Math.abs(importedMultiplier - 100) > 1e-9,
      gldOzPerShare: position.underlying === "GLD" ? finiteOrNull(ounces) : null,
      underlyingOzPerUnit: position.underlying !== "GLD" ? finiteOrNull(ounces) : null,
      markPrice: market.available ? finiteOrNull(market.markPrice) : null,
      bid: market.bid1 > 0 ? market.bid1 : null,
      ask: market.ask1 > 0 ? market.ask1 : null,
      bidSize: market.bidSize,
      askSize: market.askSize,
      markIV: market.markIv > 0 ? market.markIv : null,
      bidIV: market.bidIv ?? null,
      askIV: market.askIv ?? null,
      ivSpread: market.bidIv != null && market.askIv != null ? market.askIv - market.bidIv : null,
      unitDelta: finiteOrNull(market.delta),
      unitGamma: market.available ? finiteOrNull(market.gamma) : null,
      unitTheta: market.available ? finiteOrNull(market.theta) : null,
      unitVega: market.available ? finiteOrNull(market.vega) : null,
      totalDeltaXAU: finiteOrNull(calculated.totalDeltaXau),
      totalGammaXAU: finiteOrNull(calculated.totalGammaXau),
      totalThetaUSD: finiteOrNull(calculated.totalTheta),
      totalVegaUSD: finiteOrNull(calculated.totalVega),
      MV: market.available ? finiteOrNull(calculated.currentValue) : null,
      entryPrice: finiteOrNull(position.entryPrice),
      entryCost: finiteOrNull(position.importedEntryCost) ?? finiteOrNull(calculated.entryCost),
      UPL: market.available ? finiteOrNull(calculated.pnl) : null,
      notionalSizeUSD: finiteOrNull(calculated.notionalSize),
      quoteTime: market.quoteTime,
      positionTime,
      source: market.source || null,
      dataStatus: fallbackStatus(market),
      positionKind: "held",
      openInterest: finiteOrNull(position.openInterest),
      volume: finiteOrNull(position.optionVolume),
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

type ChainQuote = {
  symbol: string; expiry: string; strike: number; optionType: "call" | "put"; markPrice: number; markIv: number;
  bidIv?: number | null; askIv?: number | null; ivSpread?: number | null;
  bid1Price: number; ask1Price: number; bid1Size?: number | null; ask1Size?: number | null; delta: number; gamma: number; theta: number; vega: number;
  timestamp: number; source: string; openInterest?: number; volume?: number;
  marketAvailable?: boolean;
};

export function buildChainRiskPositions(quotes: ChainQuote[], underlying: "GLD" | "XAUT" | "BTC", xauPerUnit: number | null): RiskPosition[] {
  return quotes.map(quote => {
    const marketAvailable = quote.marketAvailable !== false;
    return ({
    id: `chain:${quote.symbol}`,
    venue: underlying === "GLD" ? "Cboe / OPRA" : "Bybit",
    broker: "MARKET CHAIN",
    account: "LISTED-NO-POSITION",
    underlying,
    instrument: quote.symbol,
    callPut: quote.optionType,
    expiry: quote.expiry,
    strike: quote.strike,
    netQty: 0,
    contractMultiplier: underlying === "GLD" ? 100 : 1,
    deliverableSource: underlying === "GLD"
      ? "OCC standard GLD contract display · verify adjusted deliverables with broker contract master"
      : "Bybit V5 instrument specification",
    contractAdjusted: false,
    gldOzPerShare: underlying === "GLD" ? xauPerUnit : null,
    underlyingOzPerUnit: underlying !== "GLD" ? xauPerUnit : null,
    markPrice: marketAvailable && quote.markPrice > 0 ? quote.markPrice : null,
    bid: quote.bid1Price > 0 ? quote.bid1Price : 0,
    ask: quote.ask1Price > 0 ? quote.ask1Price : 0,
    bidSize: quote.bid1Size ?? null,
    askSize: quote.ask1Size ?? null,
    markIV: marketAvailable && quote.markIv > 0 ? quote.markIv : null,
    bidIV: quote.bidIv ?? null,
    askIV: quote.askIv ?? null,
    ivSpread: quote.ivSpread ?? null,
    unitDelta: marketAvailable && Number.isFinite(quote.delta) ? quote.delta : null,
    unitGamma: marketAvailable && Number.isFinite(quote.gamma) ? quote.gamma : null,
    unitTheta: marketAvailable && Number.isFinite(quote.theta) ? quote.theta : null,
    unitVega: marketAvailable && Number.isFinite(quote.vega) ? quote.vega : null,
    totalDeltaXAU: null, totalGammaXAU: null, totalThetaUSD: null, totalVegaUSD: null,
    MV: null, entryPrice: null, entryCost: null, UPL: null,
    quoteTime: new Date(quote.timestamp).toISOString(),
    positionTime: null,
    source: quote.source,
    dataStatus: !marketAvailable ? "MISSING" : quote.source.includes("Cboe") || Date.now() - quote.timestamp > 15 * 60_000 ? "STALE" : "LIVE",
    positionKind: "listed",
    openInterest: quote.openInterest ?? null,
    volume: quote.volume ?? null,
  });
  });
}

export function buildGldChainRiskPositions(quotes: ChainQuote[], gldOzPerShare: number | null): RiskPosition[] {
  return buildChainRiskPositions(quotes, "GLD", gldOzPerShare);
}
