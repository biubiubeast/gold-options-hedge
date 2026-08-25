import { describe, expect, it } from "vitest";
import { impliedVolatilityFromPrice, normalizeCboeGldOption, normalizeDeribitOption, parseCboeTimestamp } from "./marketData";

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
    expect(quote).toMatchObject({ bidIvDerived: true, askIvDerived: true });
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

describe("Deribit inverse option normalization", () => {
  it("keeps native coin premium, converts IV to decimals, and derives model risk fields", () => {
    const asOf = Date.parse("2026-08-19T08:00:00Z");
    const quote = normalizeDeribitOption({
      state: "open", kind: "option", instrument_name: "ETH-25SEP26-2000-C",
      expiration_timestamp: Date.parse("2026-09-25T08:00:00Z"), is_active: true,
      contract_size: 1, strike: 2000, base_currency: "ETH", quote_currency: "ETH", option_type: "call",
    }, {
      instrument_name: "ETH-25SEP26-2000-C", bid_price: 0.06, ask_price: 0.08,
      mark_price: 0.07, mark_iv: 50, underlying_price: 2000, interest_rate: 0,
      open_interest: 120, volume: 15, creation_timestamp: asOf,
      base_currency: "ETH", quote_currency: "ETH",
    }, asOf);
    expect(quote).toMatchObject({
      optionType: "call", expiry: "2026-09-25", strike: 2000,
      markPrice: 0.07, markIv: 0.5, premiumCurrency: "ETH",
      contractMultiplier: 1, marketAvailable: true,
    });
    expect(quote.delta).toBeGreaterThan(0);
    expect(quote.bidIv).not.toBeNull();
    expect(quote.askIv).not.toBeNull();
    expect(quote.askIv!).toBeGreaterThan(quote.bidIv!);
  });
});
