import { describe, expect, it } from "vitest";
import {
  impliedVolatilityFromPrice,
  normalizeCboeGldOption,
  normalizeDeribitOption,
  normalizeMarketDataOption,
  normalizeTradierOption,
  parseCboeTimestamp,
} from "./marketData";

describe("Cboe timestamp normalization", () => {
  it("treats timezone-less Cboe timestamps as UTC", () => {
    expect(parseCboeTimestamp("2026-08-12 08:16:24")).toBe(
      Date.parse("2026-08-12T08:16:24Z")
    );
  });
});

describe("licensed GLD provider normalization", () => {
  it("keeps MarketData.app top size, OI and volume instead of dropping them", () => {
    const quote = normalizeMarketDataOption(
      {
        s: "ok",
        optionSymbol: ["GLD260828C00420000"],
        bid: [8.1],
        ask: [8.4],
        mid: [8.25],
        bidSize: [14],
        askSize: [21],
        iv: [0.29],
        delta: [0.61],
        gamma: [0.02],
        theta: [-0.08],
        vega: [0.16],
        openInterest: [1240],
        volume: [83],
        underlyingPrice: [426.69],
        updated: [Date.parse("2026-08-26T01:00:00Z") / 1000],
      },
      {
        expiry: "2026-08-28",
        strike: 420,
        optionType: "call",
      }
    );

    expect(quote).toMatchObject({
      bid1Size: 14,
      ask1Size: 21,
      openInterest: 1240,
      volume: 83,
      tradeable: true,
      marketAvailable: true,
    });
  });

  it("keeps Tradier top size, OI and volume instead of dropping them", () => {
    const quote = normalizeTradierOption(
      {
        symbol: "GLD260828P00420000",
        option_type: "put",
        expiration_date: "2026-08-28",
        strike: 420,
        bid: 1.9,
        ask: 2.1,
        bidsize: 9,
        asksize: 11,
        open_interest: 880,
        volume: 47,
        underlying_price: 426.69,
        greeks: {
          mid_iv: 0.31,
          delta: -0.29,
          gamma: 0.02,
          theta: -0.07,
          vega: 0.13,
        },
      },
      "2026-08-28"
    );

    expect(quote).toMatchObject({
      bid1Size: 9,
      ask1Size: 11,
      openInterest: 880,
      volume: 47,
      tradeable: true,
      marketAvailable: true,
    });
  });
});

describe("Cboe GLD full-chain normalization", () => {
  it("parses OCC symbols and keeps market/Greek metadata explicit", () => {
    const quote = normalizeCboeGldOption(
      {
        option: "GLD260821P00400000",
        bid: 2.1,
        ask: 2.3,
        iv: 0.245,
        delta: -0.42,
        gamma: 0.03,
        theta: -0.08,
        vega: 0.14,
        open_interest: 912,
        volume: 88,
      },
      Date.parse("2026-08-12T03:44:37Z")
    );
    expect(quote).toMatchObject({
      expiry: "2026-08-21",
      strike: 400,
      optionType: "put",
      markPrice: 2.2,
      markIv: 0.245,
      delta: -0.42,
      source: "Cboe delayed options / OPRA",
      openInterest: 912,
      volume: 88,
      tradeable: true,
    });
  });

  it("keeps Cboe market IV separate and derives MODEL IV from synchronized prices", () => {
    const asOf = Date.parse("2026-08-12T08:00:00Z");
    const quote = normalizeCboeGldOption(
      {
        option: "GLD260821C00400000",
        bid: 8.2,
        ask: 8.8,
        iv: 0.245,
        delta: 0.54,
        gamma: 0.03,
        theta: -0.08,
        vega: 0.14,
      },
      asOf,
      402.5
    );
    expect(quote).toMatchObject({ bidIv: null, askIv: null, ivSpread: null });
    expect(quote?.modelMarkIv).not.toBeNull();
    expect(quote?.modelBidIv).not.toBeNull();
    expect(quote?.modelAskIv).not.toBeNull();
    expect(quote!.modelAskIv!).toBeGreaterThan(quote!.modelBidIv!);
    expect(quote!.modelIvSpread).toBeCloseTo(
      quote!.modelAskIv! - quote!.modelBidIv!,
      8
    );
    expect(quote).toMatchObject({
      modelMarkIvStatus: "MODEL",
      modelBidIvStatus: "MODEL",
      modelAskIvStatus: "MODEL",
      ivReferenceSpot: 402.5,
    });
  });

  it.each([
    ["GLD260828C00415000", 12.8, 13.4],
    ["GLD260828P00415000", 1.16, 1.27],
    ["GLD260828C00420000", 9.15, 9.5],
    ["GLD260828P00420000", 2.25, 2.4],
  ])(
    "derives the 28 Aug 415/420 Cboe MODEL IV %s instead of leaving it blank",
    (option, bid, ask) => {
      const quote = normalizeCboeGldOption(
        { option, bid, ask, iv: 0.29 },
        Date.parse("2026-08-25T03:44:36Z"),
        426.69
      );
      expect(quote).toMatchObject({ bidIv: null, askIv: null, ivSpread: null });
      expect(quote?.modelBidIv).not.toBeNull();
      expect(quote?.modelAskIv).not.toBeNull();
      expect(quote!.modelAskIv!).toBeGreaterThan(quote!.modelBidIv!);
      expect(quote!.modelIvSpread).toBeCloseTo(
        quote!.modelAskIv! - quote!.modelBidIv!,
        10
      );
    }
  );

  it("explains why a newer display spot must not be used for 28 Aug 415 Call MODEL IV", () => {
    const quote = normalizeCboeGldOption(
      {
        option: "GLD260828C00415000",
        bid: 12.8,
        ask: 13.4,
        iv: 0.2924,
      },
      Date.parse("2026-08-25T03:44:36Z"),
      429.11
    );
    expect(quote).toMatchObject({
      modelBidIv: null,
      modelAskIv: null,
      modelBidIvStatus: "PRICE_BELOW_INTRINSIC",
      modelAskIvStatus: "PRICE_BELOW_INTRINSIC",
    });
  });

  it("does not invent a contract when an OCC symbol is invalid", () => {
    expect(
      normalizeCboeGldOption({ option: "MISSING" }, Date.now())
    ).toBeNull();
  });
});

describe("implied volatility inversion", () => {
  it("returns null for an impossible quote instead of silently using zero", () => {
    expect(
      impliedVolatilityFromPrice({
        price: 500,
        spot: 400,
        strike: 400,
        expiry: "2026-09-18",
        optionType: "call",
        asOf: Date.parse("2026-08-12T08:00:00Z"),
      })
    ).toBeNull();
  });
});

describe("Deribit inverse option normalization", () => {
  it("keeps native coin premium, converts IV to decimals, and derives model risk fields", () => {
    const asOf = Date.parse("2026-08-19T08:00:00Z");
    const quote = normalizeDeribitOption(
      {
        state: "open",
        kind: "option",
        instrument_name: "ETH-25SEP26-2000-C",
        expiration_timestamp: Date.parse("2026-09-25T08:00:00Z"),
        is_active: true,
        contract_size: 1,
        strike: 2000,
        base_currency: "ETH",
        quote_currency: "ETH",
        option_type: "call",
      },
      {
        instrument_name: "ETH-25SEP26-2000-C",
        bid_price: 0.06,
        ask_price: 0.08,
        mark_price: 0.07,
        mark_iv: 50,
        underlying_price: 2000,
        interest_rate: 0,
        open_interest: 120,
        volume: 15,
        creation_timestamp: asOf,
        base_currency: "ETH",
        quote_currency: "ETH",
      },
      asOf
    );
    expect(quote).toMatchObject({
      optionType: "call",
      expiry: "2026-09-25",
      strike: 2000,
      markPrice: 0.07,
      markIv: 0.5,
      premiumCurrency: "ETH",
      contractMultiplier: 1,
      marketAvailable: true,
    });
    expect(quote.delta).toBeGreaterThan(0);
    expect(quote).toMatchObject({ bidIv: null, askIv: null });
    expect(quote.modelMarkIv).not.toBeNull();
    expect(quote.modelBidIv).not.toBeNull();
    expect(quote.modelAskIv).not.toBeNull();
    expect(quote.modelAskIv!).toBeGreaterThan(quote.modelBidIv!);
  });

  it("merges native ticker size, Bid/Ask IV and Greeks into the full-chain quote", () => {
    const asOf = Date.parse("2026-08-26T00:00:00Z");
    const quote = normalizeDeribitOption(
      {
        state: "open",
        kind: "option",
        instrument_name: "BTC-11SEP26-76000-C",
        expiration_timestamp: Date.parse("2026-09-11T08:00:00Z"),
        is_active: true,
        contract_size: 1,
        strike: 76000,
        base_currency: "BTC",
        quote_currency: "BTC",
        option_type: "call",
      },
      {
        instrument_name: "BTC-11SEP26-76000-C",
        bid_price: 0.057,
        ask_price: 0.059,
        mark_price: 0.058,
        mark_iv: 40.91,
        underlying_price: 79280,
        interest_rate: 0,
        open_interest: 112.8,
        volume: 2.1,
        creation_timestamp: asOf,
        base_currency: "BTC",
        quote_currency: "BTC",
      },
      asOf,
      {
        instrument_name: "BTC-11SEP26-76000-C",
        best_bid_price: 0.0565,
        best_bid_amount: 22.2,
        best_ask_price: 0.06,
        best_ask_amount: 18,
        bid_iv: 38.36,
        ask_iv: 43.16,
        mark_iv: 40.91,
        mark_price: 0.058,
        underlying_price: 79280.86,
        interest_rate: 0,
        open_interest: 112.8,
        timestamp: asOf + 2_000,
        state: "open",
        stats: { volume: 2.1, volume_usd: 166_000 },
        greeks: {
          delta: 0.61,
          gamma: 0.00002,
          theta: -15.4,
          vega: 21.7,
          rho: 3.2,
        },
      }
    );
    expect(quote).toMatchObject({
      bid1Price: 0.0565,
      ask1Price: 0.06,
      bid1Size: 22.2,
      ask1Size: 18,
      bidIv: 0.3836,
      askIv: 0.4316,
      delta: 0.61,
      gamma: 0.00002,
      theta: -15.4,
      vega: 21.7,
      timestamp: asOf + 2_000,
    });
    expect(quote.ivSpread).toBeCloseTo(0.048, 10);
    expect(quote.source).toContain("native top size / Bid-Ask IV / Greeks");
  });
});
