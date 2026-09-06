import { describe, expect, it } from "vitest";
import {
  backtestMaxPain,
  calculateGrossGammaZone,
  calculateIntradayPoint,
  calculateMaxPain,
  selectIntradayExpiry,
  type IntradayMaxPainPoint,
  type ResearchKline,
} from "./maxPainResearch";

describe("BTC Max Pain research", () => {
  it("uses the intrinsic-payout minimum and lower strike on a tie", () => {
    const result = calculateMaxPain([
      { strike: 100, callOi: 10, putOi: 0 },
      { strike: 110, callOi: 0, putOi: 10 },
    ]);
    expect(result?.maxPain).toBe(100);
    expect(result?.payout).toBe(100);
  });

  it("recalculates a combined strike book rather than averaging maxima", () => {
    const result = calculateMaxPain([
      { strike: 90, callOi: 20, putOi: 0 },
      { strike: 100, callOi: 0, putOi: 1 },
      { strike: 110, callOi: 0, putOi: 20 },
    ]);
    expect(result?.maxPain).toBe(100);
  });

  it("selects the nearest valid weekly expiry per observation", () => {
    const base = {
      timestamp: Date.parse("2026-08-20T00:00:00Z"),
      date: "2026-08-20",
      hourUtc: 0,
      maxPain: 100,
      minimumPayout: 0,
      callOi: 1,
      putOi: 1,
      totalOi: 2,
      strikeCount: 1,
      sourceTimestamp: Date.parse("2026-08-19T23:59:00Z"),
    } as const;
    const points: IntradayMaxPainPoint[] = [
      { ...base, maturity: "2026-08-21", product: "inverse" },
      { ...base, maturity: "2026-08-28", product: "inverse" },
    ];
    expect(selectIntradayExpiry(points, "weekly")[0].maturity).toBe(
      "2026-08-21"
    );
  });

  it("separates backward description from forward testing", () => {
    const timestamp = Date.parse("2026-08-20T00:00:00Z");
    const point = calculateIntradayPoint(
      timestamp,
      "2026-08-28",
      "combined",
      [{ strike: 110, callOi: 5, putOi: 5 }],
      timestamp - 60_000
    )!;
    const at = (time: number, close: number): ResearchKline => ({
      openTime: time - 3_600_000,
      closeTime: time - 1,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    });
    const result = backtestMaxPain(
      [point],
      [
        at(timestamp - 86_400_000, 100),
        at(timestamp, 105),
        at(timestamp + 86_400_000, 108),
      ],
      0
    );
    expect(result.rows[0].backwardTowardPain).toBe(true);
    expect(result.rows[0].forwardTowardPain).toBe(true);
  });

  it("creates a bounded gross-Gamma proxy", () => {
    const timestamp = Date.parse("2026-08-20T00:00:00Z");
    const klines = Array.from({ length: 31 * 24 }, (_, index) => ({
      openTime: timestamp - (31 * 24 - index) * 3_600_000,
      closeTime: timestamp - (31 * 24 - index - 1) * 3_600_000 - 1,
      open: 100 + index * 0.01,
      high: 101 + index * 0.01,
      low: 99 + index * 0.01,
      close: 100 + index * 0.01,
      volume: 1,
    }));
    const zone = calculateGrossGammaZone(
      "2026-08-20",
      {
        maturity: "2026-08-28",
        product: "combined",
        strikes: [
          { strike: 90, callOi: 2, putOi: 2 },
          { strike: 105, callOi: 100, putOi: 100 },
          { strike: 120, callOi: 2, putOi: 2 },
        ],
      },
      klines
    );
    expect(zone).not.toBeNull();
    expect(zone!.lowerStrike).toBeLessThanOrEqual(zone!.peakStrike);
    expect(zone!.peakStrike).toBeLessThanOrEqual(zone!.upperStrike);
  });
});
