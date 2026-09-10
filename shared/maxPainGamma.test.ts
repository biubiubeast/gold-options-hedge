import { describe, expect, it } from "vitest";
import { calculateSignedGamma, GAMMA_MODELS } from "./maxPainGamma";
import {
  calculateGrossGammaZone,
  estimateGammaVolatility,
  type GammaStrikeBook,
  type ResearchKline,
} from "./maxPainResearch";

const date = "2026-08-20",
  t = Date.parse(`${date}T00:00:00Z`);
const candle = (time: number, close = 100): ResearchKline => ({
  openTime: time,
  closeTime: time + 3_600_000 - 1,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});
const one = [candle(t - 3_600_000)];
const book: GammaStrikeBook = {
  maturity: "2026-09-18",
  product: "inverse",
  strikes: [
    { strike: 90, callOi: 10, putOi: 0 },
    { strike: 110, callOi: 0, putOi: 10 },
  ],
};

describe("Gamma historical scenarios", () => {
  it("finds a repriced zero crossing, not the spot or an OI-interpolated strike", () => {
    const s = calculateSignedGamma(date, book, one, "call-long-put-short")!;
    const years = (Date.parse("2026-09-18T08:00:00Z") - t) / (365 * 86400000);
    const exact = Math.sqrt(90 * 110) * Math.exp(-0.5 * 0.6 ** 2 * years);
    expect(s.flips).toHaveLength(1);
    expect(Math.abs(s.nearestFlip! - exact)).toBeLessThan(0.01);
    expect(s.positiveGamma).toBeGreaterThan(0);
    expect(s.negativeGamma).toBeLessThan(0);
    expect(s.netGamma).toBeCloseTo(s.positiveGamma + s.negativeGamma, 9);
    expect(s.volatilityFallback).toBe(true);
    const reverse = calculateSignedGamma(
      date,
      book,
      one,
      "call-short-put-long"
    )!;
    expect(reverse.netGamma).toBeCloseTo(-s.netGamma, 9);
    expect(reverse.nearestFlip).toBeCloseTo(s.nearestFlip!, 8);
  });
  it("does not invent Flip prices for one-sided or perfectly balanced positions", () => {
    for (const model of ["all-long", "all-short"] as const) {
      const s = calculateSignedGamma(date, book, one, model)!;
      expect(s.flipStatus).toBe("none-in-range");
      expect(s.flips).toEqual([]);
      expect(s.nearestFlip).toBeUndefined();
    }
    const s = calculateSignedGamma(
      date,
      { ...book, strikes: [{ strike: 100, callOi: 10, putOi: 10 }] },
      one,
      "call-long-put-short"
    )!;
    expect(s.flipStatus).toBe("balanced");
    expect(s.netGamma).toBe(0);
    expect(s.positiveBand).toBeUndefined();
  });
  it("reports multiple detected crossings and the nearest, without assuming uniqueness", () => {
    const history = Array.from({ length: 48 }, (_, i) =>
      candle(t - (48 - i) * 3600000)
    );
    const s = calculateSignedGamma(
      date,
      {
        ...book,
        strikes: [
          { strike: 80, callOi: 10, putOi: 0 },
          { strike: 100, callOi: 0, putOi: 20 },
          { strike: 120, callOi: 10, putOi: 0 },
        ],
      },
      history,
      "call-long-put-short"
    )!;
    expect(s.flips).toHaveLength(2);
    expect(s.volatilityFloor).toBe(true);
    expect(s.nearestFlip).toBe(
      [...s.flips].sort((a, b) => Math.abs(a - 100) - Math.abs(b - 100))[0]
    );
  });
  it("never uses the observation hour future close, even when input is unsorted", () => {
    const history = Array.from({ length: 48 }, (_, i) =>
      candle(t - (48 - i) * 3600000, 100 + Math.sin(i))
    );
    const future = candle(t, 1000);
    expect(estimateGammaVolatility([...history, future].reverse(), t)).toEqual(
      estimateGammaVolatility(history, t)
    );
    expect(calculateGrossGammaZone(date, book, [...history, future])).toEqual(
      calculateGrossGammaZone(date, book, history)
    );
    for (const m of GAMMA_MODELS)
      expect(
        calculateSignedGamma(date, book, [...history, future], m.id)
      ).toEqual(calculateSignedGamma(date, book, history, m.id));
    expect(
      estimateGammaVolatility(
        history.filter((_, i) => i !== 20),
        t
      ).sampleCount
    ).toBe(45);
  });
  it("rejects expired/missing data and clips the snapshot at actual expiry", () => {
    expect(
      calculateSignedGamma(
        date,
        { ...book, maturity: "2026-08-19" },
        one,
        "all-long"
      )
    ).toBeNull();
    expect(calculateSignedGamma(date, book, [], "all-long")).toBeNull();
    expect(
      calculateSignedGamma(date, { ...book, maturity: date }, one, "all-long")!
        .validUntil
    ).toBe(t + 8 * 3600000);
  });
});
