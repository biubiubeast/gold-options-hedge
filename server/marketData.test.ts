import { describe, expect, it } from "vitest";
import { impliedVolatilityFromPrice, normalizeCboeGldOption, parseCboeTimestamp } from "./marketData";

describe("Cboe timestamp normalization", () => {
  it("treats timezone-less Cboe timestamps as UTC", () => {
    expect(parseCboeTimestamp("2026-08-12 08:16:24"))
      .toBe(Date.parse("2026-08-12T08:16:24Z"));
  });
});

describe("Cboe GLD full-chain normalization", () => {
  it("parses OCC symbols and keeps market/Greek metadata explicit", () => {
    const quote = normalizeCboeGldOption({
      option: "GLD260821P00400000", bid: 2.1, ask: 2.3, iv: 0.245,
      delta: -0.42, gamma: 0.03, theta: -0.08, vega: 0.14,
      open_interest: 912, volume: 88,
    }, Date.parse("2026-08-12T03:44:37Z"));
    expect(quote).toMatchObject({
      expiry: "2026-08-21", strike: 400, optionType: "put", markPrice: 2.2,
      markIv: 0.245, delta: -0.42, source: "Cboe delayed options / OPRA",
      openInterest: 912, volume: 88, tradeable: true,
    });
  });

  it("derives bid/ask IV from Cboe option prices and preserves a positive IV spread", () => {
    const asOf = Date.parse("2026-08-12T08:00:00Z");
    const quote = normalizeCboeGldOption({
      option: "GLD260821C00400000", bid: 8.2, ask: 8.8, iv: 0.245,
      delta: 0.54, gamma: 0.03, theta: -0.08, vega: 0.14,
    }, asOf, 402.5);
    expect(quote?.bidIv).not.toBeNull();
    expect(quote?.askIv).not.toBeNull();
    expect(quote!.askIv!).toBeGreaterThan(quote!.bidIv!);
    expect(quote!.ivSpread).toBeCloseTo(quote!.askIv! - quote!.bidIv!, 8);
  });

  it("does not invent a contract when an OCC symbol is invalid", () => {
    expect(normalizeCboeGldOption({ option: "MISSING" }, Date.now())).toBeNull();
  });
});

describe("implied volatility inversion", () => {
  it("returns null for an impossible quote instead of silently using zero", () => {
    expect(impliedVolatilityFromPrice({
      price: 500, spot: 400, strike: 400, expiry: "2026-09-18", optionType: "call", asOf: Date.parse("2026-08-12T08:00:00Z"),
    })).toBeNull();
  });
});
