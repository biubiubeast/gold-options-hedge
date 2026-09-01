import { describe, expect, it } from "vitest";
import {
  aggregateHeatmapCellMetric,
  aggregateMetric,
  buildHeatScale,
  canonicalStrike,
  calculateScenario,
  classifyOptionMoneyness,
  enrichRiskPositions,
  expiryBucketMatchesDte,
  expiryHeldMetricTotal,
  exerciseControl,
  finiteOrNull,
  formatCompact,
  formatSpotPrice,
  formatStrike,
  formatStrikeDistanceFromSpot,
  generateMockPositions,
  magnitudeHeatColor,
  metricSelectorLabel,
  metricDistribution,
  metricValue,
  nearestStrikeLevels,
  optionMatchesMoneynessFilter,
  resolveIvMetric,
  isIvSelectorMetric,
  isModelIvMetric,
  isMetricValueInStatisticalSample,
  spotRangeState,
  strikeDistanceFromSpot,
} from "../shared/riskHeatmap";
import { DEFAULT_FORMULAS } from "../shared/marketTypes";

const asOf = new Date("2026-08-11T10:00:00.000Z");
const spots = {
  GLD: 247.3,
  XAUT: 3358,
  BTC: 95_000,
  ETH: 3_300,
  XAU: 3358,
} as const;

describe("institutional risk heatmap acceptance", () => {
  it("keeps IV metric labels source-neutral and resolves Market/Model separately", () => {
    expect(isIvSelectorMetric("ivSpread")).toBe(true);
    expect(isModelIvMetric("modelIVSpread")).toBe(true);
    expect(resolveIvMetric("ivSpread", "market")).toBe("ivSpread");
    expect(resolveIvMetric("ivSpread", "model")).toBe("modelIVSpread");
    expect(resolveIvMetric("unitDelta", "model")).toBe("unitDelta");
  });

  it("formats every IV metric with two decimal places", () => {
    expect(formatCompact(0.1834, "markIV")).toBe("18.34%");
    expect(formatCompact(0.207, "bidIV")).toBe("20.70%");
    expect(formatCompact(0.22456, "askIV")).toBe("22.46%");
    expect(formatCompact(0.0123, "ivSpread")).toBe("1.23%");
    expect(formatCompact(0.274677, "modelBidIV")).toBe("27.47%");
    expect(formatCompact(0.329778, "modelAskIV")).toBe("32.98%");
    expect(formatCompact(0.055101, "modelIVSpread")).toBe("5.51%");
  });

  it("formats Unit Delta with three decimal places", () => {
    expect(formatCompact(0.42, "unitDelta")).toBe("+0.420");
    expect(formatCompact(-0.0574, "unitDelta")).toBe("−0.057");
    expect(formatCompact(null, "unitDelta")).toBe("MISSING");
  });

  it("labels the Volume metric with the selected market window", () => {
    expect(metricSelectorLabel("volume", "GLD")).toBe("Volume (Session)");
    expect(metricSelectorLabel("volume", "XAUT")).toBe("Volume (24h)");
    expect(metricSelectorLabel("volume", "BTC")).toBe("Volume (24h)");
    expect(metricSelectorLabel("volume", "ETH")).toBe("Volume (24h)");
    expect(metricSelectorLabel("volume", "all")).toBe("Volume");
    expect(metricSelectorLabel("unitDelta", "GLD")).toBe("Unit Delta");
  });

  it("normalizes Volume to additive USD notional and preserves missing inputs", () => {
    const raw = generateMockPositions(2, 83, asOf).map((position, index) => ({
      ...position,
      volume: index === 0 ? 125 : 75,
    }));
    const [call, put] = enrichRiskPositions(raw, spots, asOf);
    const expectedCall =
      125 * raw[0].contractMultiplier! * spots[raw[0].underlying];
    const expectedPut =
      75 * raw[1].contractMultiplier! * spots[raw[1].underlying];
    expect(metricValue(call, "volume")).toBeCloseTo(expectedCall, 8);
    expect(aggregateMetric([call, put], "volume")).toBeCloseTo(
      expectedCall + expectedPut,
      8
    );
    expect(aggregateHeatmapCellMetric([call, put], "volume")).toBeCloseTo(
      expectedCall + expectedPut,
      8
    );

    const [missing] = enrichRiskPositions(
      [{ ...raw[0], volume: null }],
      spots,
      asOf
    );
    expect(metricValue(missing, "volume")).toBeNull();
    expect(aggregateHeatmapCellMetric([call, missing], "volume")).toBeNull();

    const [zero] = enrichRiskPositions([{ ...raw[0], volume: 0 }], spots, asOf);
    expect(metricValue(zero, "volume")).toBe(0);

    const doubledFormula = DEFAULT_FORMULAS.map(formula =>
      formula.name === "volume_notional_usd"
        ? {
            ...formula,
            expression: "volume * contractMultiplier * underlyingPrice * 2",
          }
        : formula
    );
    const [custom] = enrichRiskPositions(
      [{ ...raw[1], volume: 10 }],
      spots,
      asOf,
      doubledFormula
    );
    expect(metricValue(custom, "volume")).toBeCloseTo(
      10 * raw[1].contractMultiplier! * spots[raw[1].underlying] * 2,
      8
    );
    expect(formatCompact(1_250, "volume")).toBe("1.3k");
  });

  it("generates deterministic 100/200-position datasets with required edge cases", () => {
    const hundred = generateMockPositions(100, 7, asOf);
    const twoHundred = generateMockPositions(200, 7, asOf);
    expect(hundred).toHaveLength(100);
    expect(twoHundred).toHaveLength(200);
    expect(twoHundred.some(position => position.callPut === "call")).toBe(true);
    expect(twoHundred.some(position => position.callPut === "put")).toBe(true);
    expect(twoHundred.some(position => position.contractAdjusted)).toBe(true);
    expect(twoHundred.some(position => position.dataStatus === "MISSING")).toBe(
      true
    );
    expect(twoHundred.some(position => position.dataStatus === "STALE")).toBe(
      true
    );
    const enriched = enrichRiskPositions(twoHundred, spots, asOf);
    expect(enriched.some(position => position.dte === 0)).toBe(true);
    expect(enriched.some(position => position.dte < 0)).toBe(true);
  });

  it("keeps Unit Delta and Total Delta rankings distinct", () => {
    const enriched = enrichRiskPositions(
      generateMockPositions(100, 7, asOf),
      spots,
      asOf
    );
    const unitWinner = [...enriched]
      .filter(position => position.unitDelta !== null)
      .sort(
        (a, b) =>
          Math.abs(metricValue(b, "unitDelta") ?? 0) -
          Math.abs(metricValue(a, "unitDelta") ?? 0)
      )[0];
    const totalWinner = [...enriched]
      .filter(position => position.totalDeltaXAU !== null)
      .sort(
        (a, b) =>
          Math.abs(metricValue(b, "totalDelta") ?? 0) -
          Math.abs(metricValue(a, "totalDelta") ?? 0)
      )[0];
    expect(unitWinner.id).toBe("mock-unit-large-total-small");
    expect(totalWinner.id).toBe("mock-unit-small-total-large");
  });

  it("propagates Qty +1 through totals, heatmap, expiry control and scenario", () => {
    const raw = generateMockPositions(100, 11, asOf);
    const target = raw.find(
      position =>
        position.underlying === "GLD" &&
        position.expiry === "2026-08-12" &&
        position.unitDelta !== null
    )!;
    const before = enrichRiskPositions(raw, spots, asOf);
    const afterRaw = raw.map(position =>
      position.id === target.id
        ? { ...position, netQty: position.netQty + 1 }
        : position
    );
    const after = enrichRiskPositions(afterRaw, spots, asOf);
    const beforeTarget = before.find(position => position.id === target.id)!;
    const afterTarget = after.find(position => position.id === target.id)!;
    expect(afterTarget.totalDeltaXAU).not.toBe(beforeTarget.totalDeltaXAU);
    expect(aggregateMetric([afterTarget], "totalDelta")).not.toBe(
      aggregateMetric([beforeTarget], "totalDelta")
    );
    expect(
      exerciseControl(afterTarget, spots.GLD).estimatedFundingUSD
    ).not.toBe(exerciseControl(beforeTarget, spots.GLD).estimatedFundingUSD);
    const scenarioInput = {
      xauShockPct: -10,
      ivShockPoints: 5,
      day: 3 as const,
      vanNakedDeltaXau: 120,
      spots,
    };
    expect(calculateScenario(after, scenarioInput).optionPnlUSD).not.toBe(
      calculateScenario(before, scenarioInput).optionPnlUSD
    );
  });

  it("keeps a spot marker state visible outside the strike range", () => {
    expect(spotRangeState([200, 220, 240], 300)).toEqual({
      state: "above",
      nearestStrike: 240,
    });
    expect(spotRangeState([200, 220, 240], 100)).toEqual({
      state: "below",
      nearestStrike: 200,
    });
    expect(spotRangeState([200, 220, 240], 223).state).toBe("within");
  });

  it("marks only the single closest listed strike as ATM", () => {
    const xautStrikes = Array.from(
      { length: 17 },
      (_, index) => 4250 + index * 10
    );
    expect(nearestStrikeLevels(xautStrikes, 4337)).toEqual([4340]);
    expect(nearestStrikeLevels([395, 397, 399, 401, 403], 399.52)).toEqual([
      399,
    ]);
  });

  it("filters ITM and OTM from spot without misclassifying the nearest listed strike", () => {
    expect(classifyOptionMoneyness(400, 401, "call")).toBe("ITM");
    expect(classifyOptionMoneyness(395, 401, "call")).toBe("ITM");
    expect(classifyOptionMoneyness(405, 401, "call")).toBe("OTM");
    expect(classifyOptionMoneyness(395, 401, "put")).toBe("OTM");
    expect(classifyOptionMoneyness(405, 401, "put")).toBe("ITM");
    expect(classifyOptionMoneyness(401, 401, "call")).toBe("ATM");
  });

  it("combines Call and Put OTM contracts without overlapping strikes", () => {
    const strikes = [90, 95, 100, 105, 110];
    const callOtm = strikes.filter(
      strike => classifyOptionMoneyness(strike, 100, "call") === "OTM"
    );
    const putOtm = strikes.filter(
      strike => classifyOptionMoneyness(strike, 100, "put") === "OTM"
    );
    expect(callOtm).toEqual([105, 110]);
    expect(putOtm).toEqual([90, 95]);
    expect(callOtm.filter(strike => putOtm.includes(strike))).toEqual([]);
  });

  it.each([
    ["GLD", 422.87, [420, 423, 425]],
    ["XAUT", 4_412, [4_400, 4_410, 4_420]],
    ["BTC", 80_050, [79_000, 80_000, 81_000]],
    ["ETH", 3_304, [3_250, 3_300, 3_350]],
  ])(
    "retains the nearest %s strike in both combined ITM and OTM views",
    (_underlying, spot, strikes) => {
      const atmStrike = nearestStrikeLevels(strikes, spot)[0];
      const sides = ["call", "put"] as const;
      for (const filter of ["itm", "otm"] as const) {
        expect(
          sides.some(callPut =>
            optionMatchesMoneynessFilter(atmStrike, spot, callPut, filter)
          )
        ).toBe(true);
      }
    }
  );

  it("retains a true-ATM row when spot equals the listed strike", () => {
    expect(optionMatchesMoneynessFilter(423, 423, "call", "otm")).toBe(true);
    expect(optionMatchesMoneynessFilter(423, 423, "put", "itm")).toBe(true);
  });

  it("formats every heatmap spot value with exactly two decimals", () => {
    expect(formatSpotPrice(401)).toBe("401.00");
    expect(formatSpotPrice(4366.6)).toBe("4,366.60");
    expect(formatSpotPrice(null)).toBe("MISSING");
  });

  it("preserves listed strike precision so different contracts never share an axis label", () => {
    expect(canonicalStrike(387.50000000000006)).toBe(387.5);
    expect(canonicalStrike(387.5)).not.toBe(canonicalStrike(388));
    expect(formatStrike(387.5)).toBe("387.5");
    expect(formatStrike(388)).toBe("388");
    expect(formatStrike(387.5)).not.toBe(formatStrike(388));
    expect(formatStrike(1234.125)).toBe("1,234.125");
  });

  it("replaces ITM/OTM labels with signed strike distance versus spot", () => {
    expect(strikeDistanceFromSpot(110, 100)).toBeCloseTo(0.1);
    expect(formatStrikeDistanceFromSpot(110, 100)).toBe("+10.00%");
    expect(formatStrikeDistanceFromSpot(90, 100)).toBe("−10.00%");
    expect(formatStrikeDistanceFromSpot(100, 100)).toBe("+0.00%");
    expect(formatStrikeDistanceFromSpot(100, 0)).toBe("MISSING");
  });

  it("covers 0DTE, expired, adjusted, missing and stale without silent zeroes", () => {
    const enriched = enrichRiskPositions(
      generateMockPositions(200, 19, asOf),
      spots,
      asOf
    );
    expect(enriched.some(position => position.dte === 0)).toBe(true);
    expect(enriched.some(position => position.dte < 0)).toBe(true);
    expect(
      enriched.some(
        position => position.contractAdjusted && position.dataStatus === "WARN"
      )
    ).toBe(true);
    const missing = enriched.find(
      position => position.dataStatus === "MISSING"
    )!;
    expect(missing.unitDelta).toBeNull();
    expect(aggregateMetric([missing], "unitDelta")).toBeNull();
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(enriched.some(position => position.dataStatus === "STALE")).toBe(
      true
    );
  });

  it("uses p99 clipping and separates 50 from 1000 on log scale", () => {
    const scale = buildHeatScale(
      [1, 5, 10, 50, 100, 1000, 1_000_000],
      "log",
      false
    );
    expect(scale.clipHigh).toBeLessThan(1_000_000);
    expect(scale.normalize(1000) - scale.normalize(50)).toBeGreaterThan(0.15);
    expect(scale.bins.length).toBeGreaterThanOrEqual(6);
  });

  it("maps low-to-high absolute values from green through yellow to red", () => {
    const scale = buildHeatScale([0, 0.05, 0.5, 0.8, 1000], "quantile", false);
    expect(magnitudeHeatColor(scale.normalize(0))).toContain("22 163 74");
    expect(magnitudeHeatColor(0.5)).toContain("250 204 21");
    expect(magnitudeHeatColor(scale.normalize(scale.clipHigh))).toContain(
      "239 68 68"
    );
    expect(
      aggregateMetric(
        enrichRiskPositions(generateMockPositions(100, 7, asOf), spots, asOf),
        "totalDelta"
      )
    ).not.toBeNull();
  });

  it("persists comparable custom bounds and calculates Qty and underlying notional", () => {
    const scale = buildHeatScale([1, 5, 100], "quantile", false, {
      min: 0,
      max: 20,
    });
    expect(scale.custom).toBe(true);
    expect(scale.clipLow).toBe(0);
    expect(scale.clipHigh).toBe(20);
    expect(scale.normalize(10)).toBe(0.5);
    const enriched = enrichRiskPositions(
      generateMockPositions(100, 7, asOf),
      spots,
      asOf
    );
    const position = enriched.find(item => item.contractMultiplier !== null)!;
    expect(metricValue(position, "qty")).toBe(position.netQty);
    expect(metricValue(position, "notionalSize")).toBeCloseTo(
      position.netQty *
        position.contractMultiplier! *
        spots[position.underlying]
    );
    expect(aggregateMetric([position], "notionalSize")).toBe(
      position.notionalSizeUSD
    );
  });

  it("excludes listed-only contracts from held Qty and Notional heat ranges", () => {
    const source = generateMockPositions(2, 31, asOf);
    const held = enrichRiskPositions(
      [{ ...source[0], id: "held", netQty: 4, positionKind: "held" }],
      spots,
      asOf
    )[0];
    const listed = enrichRiskPositions(
      [{ ...source[1], id: "listed", netQty: 0, positionKind: "listed" }],
      spots,
      asOf
    )[0];
    expect(aggregateHeatmapCellMetric([listed], "qty")).toBeNull();
    expect(aggregateHeatmapCellMetric([listed], "notionalSize")).toBeNull();
    expect(aggregateHeatmapCellMetric([held, listed], "qty")).toBe(4);
    const scale = buildHeatScale([4, 7], "quantile", false, {
      min: 4,
      max: 7,
      basis: "held",
    });
    expect(scale.rangeBasis).toBe("held");
    expect(scale.custom).toBe(false);
    expect(scale.clipLow).toBe(4);
    expect(scale.clipHigh).toBe(7);
  });

  it("leaves a cell ungraded when any selected-metric input is missing", () => {
    const source = enrichRiskPositions(
      generateMockPositions(2, 47, asOf),
      spots,
      asOf
    );
    const valid = { ...source[0], unitDelta: 0.42 };
    const missing = { ...source[1], unitDelta: null };
    const invalid = { ...source[1], unitDelta: Number.NaN };
    expect(
      aggregateHeatmapCellMetric([valid, missing], "unitDelta")
    ).toBeNull();
    expect(
      aggregateHeatmapCellMetric([valid, invalid], "unitDelta")
    ).toBeNull();
    expect(aggregateHeatmapCellMetric([valid], "unitDelta")).toBe(0.42);
  });

  it("leaves a zero Unit Delta cell visible but ungraded", () => {
    const source = enrichRiskPositions(
      generateMockPositions(1, 53, asOf),
      spots,
      asOf
    )[0];
    expect(
      aggregateHeatmapCellMetric([{ ...source, unitDelta: 0 }], "unitDelta")
    ).toBeNull();
    expect(metricValue({ ...source, unitDelta: 0 }, "unitDelta")).toBe(0);
  });

  it("reports Expiry metric quartiles and summary statistics without converting missing values to zero", () => {
    const source = enrichRiskPositions(
      generateMockPositions(3, 49, asOf),
      spots,
      asOf
    );
    const positions = [
      { ...source[0], unitDelta: 0.1 },
      { ...source[1], unitDelta: null },
      { ...source[2], unitDelta: 0.7 },
    ];
    const distribution = metricDistribution(positions, "unitDelta");
    expect(distribution).toMatchObject({
      min: 0.1,
      median: 0.4,
      max: 0.7,
      validCount: 2,
      excludedCount: 0,
      missingCount: 1,
    });
    expect(distribution.p25).toBeCloseTo(0.25);
    expect(distribution.p75).toBeCloseTo(0.55);
    expect(distribution.average).toBeCloseTo(0.4);
  });

  it("filters statistical samples with strict per-metric bounds and separates excluded from missing", () => {
    const source = enrichRiskPositions(
      generateMockPositions(5, 149, asOf),
      spots,
      asOf
    );
    const positions = [
      { ...source[0], unitDelta: -0.2 },
      { ...source[1], unitDelta: 0 },
      { ...source[2], unitDelta: 0.25 },
      { ...source[3], unitDelta: 0.8 },
      { ...source[4], unitDelta: null },
    ];
    const range = { lowerExclusive: 0, upperExclusive: 0.8 };
    const distribution = metricDistribution(positions, "unitDelta", range);

    expect(distribution).toMatchObject({
      min: 0.25,
      p25: 0.25,
      median: 0.25,
      average: 0.25,
      p75: 0.25,
      max: 0.25,
      validCount: 1,
      excludedCount: 3,
      missingCount: 1,
    });
    expect(isMetricValueInStatisticalSample(0, range)).toBe(false);
    expect(isMetricValueInStatisticalSample(0.8, range)).toBe(false);
    expect(isMetricValueInStatisticalSample(0.25, range)).toBe(true);
    expect(isMetricValueInStatisticalSample(null, range)).toBe(false);
    expect(isMetricValueInStatisticalSample(-0.2, null)).toBe(true);
  });

  it("shows active expiries by default and keeps expired contracts behind the explicit audit filter", () => {
    expect(expiryBucketMatchesDte(-2, "all")).toBe(false);
    expect(expiryBucketMatchesDte(-2, "expired")).toBe(true);
    expect(expiryBucketMatchesDte(0, "all")).toBe(true);
    expect(expiryBucketMatchesDte(2, "0-2")).toBe(true);
    expect(expiryBucketMatchesDte(Number.NaN, "all")).toBe(false);
  });

  it("adds held-only totals to Expiry hover for additive position metrics", () => {
    const source = enrichRiskPositions(
      generateMockPositions(3, 51, asOf),
      spots,
      asOf
    );
    const positions = [
      {
        ...source[0],
        positionKind: "held" as const,
        totalDeltaXAU: 12,
        notionalSizeUSD: 1000,
        netQty: 3,
      },
      {
        ...source[1],
        positionKind: "held" as const,
        totalDeltaXAU: -2,
        notionalSizeUSD: -200,
        netQty: -1,
      },
      {
        ...source[2],
        positionKind: "listed" as const,
        totalDeltaXAU: 999,
        notionalSizeUSD: 999_000,
        netQty: 999,
      },
    ];
    expect(expiryHeldMetricTotal(positions, "totalDelta")).toEqual({
      label: "Total Delta",
      value: 10,
    });
    expect(expiryHeldMetricTotal(positions, "notionalSize")).toEqual({
      label: "Total Notional Size USD",
      value: 800,
    });
    expect(expiryHeldMetricTotal(positions, "qty")).toEqual({
      label: "Total Qty",
      value: 2,
    });
    expect(expiryHeldMetricTotal(positions, "markIV")).toBeNull();
  });

  it("calculates editable top-of-book dollar notionals and preserves missing size", () => {
    const source = generateMockPositions(100, 53, asOf)[1];
    const custom = DEFAULT_FORMULAS.map(formula =>
      formula.name === "bid_dollar_notional"
        ? {
            ...formula,
            expression: "bidPrice * bidSize * contractMultiplier * 2",
          }
        : formula
    );
    const enriched = enrichRiskPositions(
      [
        {
          ...source,
          bid: 10,
          ask: 12,
          bidSize: 3,
          askSize: 4,
          contractMultiplier: 2,
        },
      ],
      spots,
      asOf,
      custom
    )[0];
    expect(enriched.bidDollarNotional).toBe(120);
    expect(enriched.askDollarNotional).toBe(96);
    expect(enriched.bidAskDollarNotional).toBe(216);
    expect(metricValue(enriched, "bidAskDollarNotional")).toBe(216);
    const missing = enrichRiskPositions(
      [{ ...source, bidSize: null }],
      spots,
      asOf,
      custom
    )[0];
    expect(missing.bidDollarNotional).toBeNull();
    expect(
      aggregateHeatmapCellMetric([missing], "bidDollarNotional")
    ).toBeNull();
  });

  it("converts Deribit BTC/ETH premium depth into USD with the synchronized reference spot", () => {
    const source = generateMockPositions(1, 59, asOf)[0];
    const enriched = enrichRiskPositions(
      [
        {
          ...source,
          underlying: "BTC",
          venue: "Deribit",
          premiumCurrency: "BTC",
          bid: 0.01,
          ask: 0.02,
          bidSize: 2,
          askSize: 3,
          contractMultiplier: 1,
          ivReferenceSpot: 80_000,
        },
      ],
      spots,
      asOf
    )[0];
    expect(enriched.bidDollarNotional).toBe(1_600);
    expect(enriched.askDollarNotional).toBe(4_800);
    expect(enriched.bidAskDollarNotional).toBe(6_400);
  });

  it("keeps non-USD premium depth missing when no currency conversion spot exists", () => {
    const source = generateMockPositions(1, 61, asOf)[0];
    const enriched = enrichRiskPositions(
      [
        {
          ...source,
          underlying: "ETH",
          venue: "Deribit",
          premiumCurrency: "ETH",
          bid: 0.01,
          ask: 0.02,
          bidSize: 2,
          askSize: 3,
          contractMultiplier: 1,
          ivReferenceSpot: null,
        },
      ],
      { ...spots, ETH: 0 },
      asOf
    )[0];
    expect(enriched.bidDollarNotional).toBeNull();
    expect(enriched.askDollarNotional).toBeNull();
    expect(enriched.bidAskDollarNotional).toBeNull();
  });

  it("keeps Market IV separate, derives MODEL IV, and obeys the formula toggle", () => {
    const source = generateMockPositions(100, 61, asOf).find(
      position => position.underlying === "GLD"
    )!;
    const missingIv = {
      ...source,
      underlying: "GLD" as const,
      callPut: "call" as const,
      expiry: "2026-09-18",
      strike: 250,
      bid: 8,
      ask: 9,
      bidIV: null,
      askIV: null,
      modelMarkIV: null,
      modelBidIV: null,
      modelAskIV: null,
      modelIVSpread: null,
      modelMarkIvStatus: "INVALID_INPUT" as const,
      modelBidIvStatus: "INVALID_INPUT" as const,
      modelAskIvStatus: "INVALID_INPUT" as const,
      quoteTime: asOf.toISOString(),
      ivReferenceSpot: spots.GLD,
      ivReferenceTime: asOf.toISOString(),
      ivReferenceSource: "synchronized test snapshot",
    };
    const calculated = enrichRiskPositions(
      [missingIv],
      spots,
      asOf,
      DEFAULT_FORMULAS,
      { riskFreeRate: 0.04 }
    )[0];
    expect(calculated).toMatchObject({
      bidIV: null,
      askIV: null,
      ivSpread: null,
    });
    expect(calculated.modelBidIV).not.toBeNull();
    expect(calculated.modelAskIV).not.toBeNull();
    expect(calculated.modelAskIV!).toBeGreaterThan(calculated.modelBidIV!);
    expect(calculated.modelIVSpread).toBeCloseTo(
      calculated.modelAskIV! - calculated.modelBidIV!,
      10
    );
    expect(calculated).toMatchObject({
      modelBidIvStatus: "MODEL",
      modelAskIvStatus: "MODEL",
    });

    const withNativeBid = enrichRiskPositions(
      [{ ...missingIv, bidIV: 0.33 }],
      spots,
      asOf,
      DEFAULT_FORMULAS
    )[0];
    expect(withNativeBid.bidIV).toBe(0.33);
    expect(withNativeBid.askIV).toBeNull();
    expect(withNativeBid.modelBidIV).not.toBeNull();
    expect(withNativeBid.modelAskIV).not.toBeNull();

    const disabled = DEFAULT_FORMULAS.map(formula =>
      formula.name === "bid_ask_iv_inversion_enabled"
        ? { ...formula, expression: "0" }
        : formula
    );
    const notCalculated = enrichRiskPositions(
      [missingIv],
      spots,
      asOf,
      disabled
    )[0];
    expect(notCalculated.bidIV).toBeNull();
    expect(notCalculated.askIV).toBeNull();
    expect(notCalculated.ivSpread).toBeNull();
    expect(notCalculated.modelBidIV).toBeNull();
    expect(notCalculated.modelAskIV).toBeNull();
    expect(notCalculated).toMatchObject({
      modelBidIvStatus: "DISABLED",
      modelAskIvStatus: "DISABLED",
    });
  });

  it("uses IV Reference Spot instead of Display Spot for MODEL IV", () => {
    const source = generateMockPositions(100, 71, asOf).find(
      position => position.underlying === "GLD"
    )!;
    const upstream = {
      ...source,
      underlying: "GLD" as const,
      callPut: "call" as const,
      expiry: "2026-08-28",
      strike: 415,
      bid: 12.8,
      ask: 13.4,
      bidIV: null,
      askIV: null,
      modelMarkIV: null,
      modelBidIV: null,
      modelAskIV: null,
      modelIVSpread: null,
      modelMarkIvStatus: "INVALID_INPUT" as const,
      modelBidIvStatus: "INVALID_INPUT" as const,
      modelAskIvStatus: "INVALID_INPUT" as const,
      ivReferenceSpot: 426.69,
      ivReferenceTime: "2026-08-25T03:44:36.000Z",
      ivReferenceSource: "Cboe synchronized chain snapshot",
    };
    const calculated = enrichRiskPositions(
      [upstream],
      { ...spots, GLD: 429.11 },
      new Date("2026-08-25T08:00:00.000Z"),
      DEFAULT_FORMULAS
    )[0];
    expect(calculated.ivReferenceSpot).toBe(426.69);
    expect(calculated.modelBidIV).toBeCloseTo(0.274677, 5);
    expect(calculated.modelAskIV).toBeCloseTo(0.329778, 5);
    expect(calculated.modelIVSpread).toBeCloseTo(0.055101, 5);
  });
});
