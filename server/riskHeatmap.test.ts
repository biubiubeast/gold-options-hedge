import { describe, expect, it } from "vitest";
import {
  aggregateHeatmapCellMetric,
  aggregateMetric,
  buildHeatScale,
  calculateScenario,
  enrichRiskPositions,
  exerciseControl,
  finiteOrNull,
  generateMockPositions,
  magnitudeHeatColor,
  metricValue,
  spotRangeState,
} from "../shared/riskHeatmap";

const asOf = new Date("2026-08-11T10:00:00.000Z");
const spots = { GLD: 247.3, XAUT: 3358, XAU: 3358 } as const;

describe("institutional risk heatmap acceptance", () => {
  it("generates deterministic 100/200-position datasets with required edge cases", () => {
    const hundred = generateMockPositions(100, 7, asOf);
    const twoHundred = generateMockPositions(200, 7, asOf);
    expect(hundred).toHaveLength(100);
    expect(twoHundred).toHaveLength(200);
    expect(twoHundred.some(position => position.callPut === "call")).toBe(true);
    expect(twoHundred.some(position => position.callPut === "put")).toBe(true);
    expect(twoHundred.some(position => position.contractAdjusted)).toBe(true);
    expect(twoHundred.some(position => position.dataStatus === "MISSING")).toBe(true);
    expect(twoHundred.some(position => position.dataStatus === "STALE")).toBe(true);
    const enriched = enrichRiskPositions(twoHundred, spots, asOf);
    expect(enriched.some(position => position.dte === 0)).toBe(true);
    expect(enriched.some(position => position.dte < 0)).toBe(true);
  });

  it("keeps Unit Delta and Total Delta rankings distinct", () => {
    const enriched = enrichRiskPositions(generateMockPositions(100, 7, asOf), spots, asOf);
    const unitWinner = [...enriched].filter(position => position.unitDelta !== null)
      .sort((a, b) => Math.abs(metricValue(b, "unitDelta") ?? 0) - Math.abs(metricValue(a, "unitDelta") ?? 0))[0];
    const totalWinner = [...enriched].filter(position => position.totalDeltaXAU !== null)
      .sort((a, b) => Math.abs(metricValue(b, "totalDelta") ?? 0) - Math.abs(metricValue(a, "totalDelta") ?? 0))[0];
    expect(unitWinner.id).toBe("mock-unit-large-total-small");
    expect(totalWinner.id).toBe("mock-unit-small-total-large");
  });

  it("propagates Qty +1 through totals, heatmap, expiry control and scenario", () => {
    const raw = generateMockPositions(100, 11, asOf);
    const target = raw.find(position => position.underlying === "GLD" && position.expiry === "2026-08-12" && position.unitDelta !== null)!;
    const before = enrichRiskPositions(raw, spots, asOf);
    const afterRaw = raw.map(position => position.id === target.id ? { ...position, netQty: position.netQty + 1 } : position);
    const after = enrichRiskPositions(afterRaw, spots, asOf);
    const beforeTarget = before.find(position => position.id === target.id)!;
    const afterTarget = after.find(position => position.id === target.id)!;
    expect(afterTarget.totalDeltaXAU).not.toBe(beforeTarget.totalDeltaXAU);
    expect(aggregateMetric([afterTarget], "totalDelta")).not.toBe(aggregateMetric([beforeTarget], "totalDelta"));
    expect(exerciseControl(afterTarget, spots.GLD).estimatedFundingUSD)
      .not.toBe(exerciseControl(beforeTarget, spots.GLD).estimatedFundingUSD);
    const scenarioInput = { xauShockPct: -10, ivShockPoints: 5, day: 3 as const, vanNakedDeltaXau: 120, spots };
    expect(calculateScenario(after, scenarioInput).optionPnlUSD)
      .not.toBe(calculateScenario(before, scenarioInput).optionPnlUSD);
  });

  it("keeps a spot marker state visible outside the strike range", () => {
    expect(spotRangeState([200, 220, 240], 300)).toEqual({ state: "above", nearestStrike: 240 });
    expect(spotRangeState([200, 220, 240], 100)).toEqual({ state: "below", nearestStrike: 200 });
    expect(spotRangeState([200, 220, 240], 223).state).toBe("within");
  });

  it("covers 0DTE, expired, adjusted, missing and stale without silent zeroes", () => {
    const enriched = enrichRiskPositions(generateMockPositions(200, 19, asOf), spots, asOf);
    expect(enriched.some(position => position.dte === 0)).toBe(true);
    expect(enriched.some(position => position.dte < 0)).toBe(true);
    expect(enriched.some(position => position.contractAdjusted && position.dataStatus === "WARN")).toBe(true);
    const missing = enriched.find(position => position.dataStatus === "MISSING")!;
    expect(missing.unitDelta).toBeNull();
    expect(aggregateMetric([missing], "unitDelta")).toBeNull();
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(enriched.some(position => position.dataStatus === "STALE")).toBe(true);
  });

  it("uses p99 clipping and separates 50 from 1000 on log scale", () => {
    const scale = buildHeatScale([1, 5, 10, 50, 100, 1000, 1_000_000], "log", false);
    expect(scale.clipHigh).toBeLessThan(1_000_000);
    expect(scale.normalize(1000) - scale.normalize(50)).toBeGreaterThan(0.15);
    expect(scale.bins.length).toBeGreaterThanOrEqual(6);
  });

  it("maps low-to-high absolute values from green through yellow to red", () => {
    const scale = buildHeatScale([0, 0.05, 0.5, 0.8, 1000], "quantile", false);
    expect(magnitudeHeatColor(scale.normalize(0))).toContain("22 163 74");
    expect(magnitudeHeatColor(0.5)).toContain("250 204 21");
    expect(magnitudeHeatColor(scale.normalize(scale.clipHigh))).toContain("239 68 68");
    expect(aggregateMetric(enrichRiskPositions(generateMockPositions(100, 7, asOf), spots, asOf), "totalDelta")).not.toBeNull();
  });

  it("persists comparable custom bounds and calculates Qty and underlying notional", () => {
    const scale = buildHeatScale([1, 5, 100], "quantile", false, { min: 0, max: 20 });
    expect(scale.custom).toBe(true);
    expect(scale.clipLow).toBe(0);
    expect(scale.clipHigh).toBe(20);
    expect(scale.normalize(10)).toBe(0.5);
    const enriched = enrichRiskPositions(generateMockPositions(100, 7, asOf), spots, asOf);
    const position = enriched.find(item => item.contractMultiplier !== null)!;
    expect(metricValue(position, "qty")).toBe(position.netQty);
    expect(metricValue(position, "notionalSize")).toBeCloseTo(position.netQty * position.contractMultiplier! * spots[position.underlying]);
    expect(aggregateMetric([position], "notionalSize")).toBe(position.notionalSizeUSD);
  });

  it("excludes listed-only contracts from held Qty and Notional heat ranges", () => {
    const source = generateMockPositions(2, 31, asOf);
    const held = enrichRiskPositions([{ ...source[0], id: "held", netQty: 4, positionKind: "held" }], spots, asOf)[0];
    const listed = enrichRiskPositions([{ ...source[1], id: "listed", netQty: 0, positionKind: "listed" }], spots, asOf)[0];
    expect(aggregateHeatmapCellMetric([listed], "qty")).toBeNull();
    expect(aggregateHeatmapCellMetric([listed], "notionalSize")).toBeNull();
    expect(aggregateHeatmapCellMetric([held, listed], "qty")).toBe(4);
    const scale = buildHeatScale([4, 7], "quantile", false, { min: 4, max: 7, basis: "held" });
    expect(scale.rangeBasis).toBe("held");
    expect(scale.custom).toBe(false);
    expect(scale.clipLow).toBe(4);
    expect(scale.clipHigh).toBe(7);
  });
});
