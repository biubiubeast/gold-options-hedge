import { describe, expect, it } from "vitest";
import { getOiDistributionPresentation } from "./maxPainPresentation";
import { calculateMaxPain, mergeStrikeBooks } from "./maxPainResearch";

describe("cross-expiry intrinsic-value display", () => {
  it("labels the aggregate minimum as an amount and its location as a separate price", () => {
    const view = getOiDistributionPresentation(true);
    expect(view.showIntrinsicValue).toBe(true);
    expect(view.minimumLabel).toBe("Minimum Intrinsic Value");
    expect(view.priceLabel).toBe("Minimum Intrinsic Value 对应价位");
    expect(view.amountLabel).toBe("Minimum Intrinsic Value (USD)");
    expect(view.title).not.toContain("Max Pain");
  });
  it("hides only aggregate intrinsic-value displays, not single-expiry Max Pain", () => {
    expect(getOiDistributionPresentation(true, false).showIntrinsicValue).toBe(
      false
    );
    expect(getOiDistributionPresentation(true, false).title).toBe(
      "BTC Open Interest By Strike"
    );
    for (const setting of [true, false]) {
      const single = getOiDistributionPresentation(false, setting);
      expect(single.showIntrinsicValue).toBe(true);
      expect(single.minimumLabel).toBe("Max Pain");
      expect(single.priceLabel).toBe("所选 Max Pain");
    }
    expect(
      getOiDistributionPresentation(true, undefined).showIntrinsicValue
    ).toBe(true);
  });
  it("minimizes the common-price sum, rather than adding each expiry's own minimum", () => {
    const books = [
      {
        maturity: "2026-09-18",
        product: "inverse" as const,
        strikes: [{ strike: 90, callOi: 1, putOi: 1 }],
      },
      {
        maturity: "2026-09-25",
        product: "inverse" as const,
        strikes: [{ strike: 110, callOi: 2, putOi: 2 }],
      },
    ];
    expect(
      books.reduce((n, b) => n + calculateMaxPain(b.strikes)!.payout, 0)
    ).toBe(0);
    const aggregate = calculateMaxPain(mergeStrikeBooks(books))!;
    expect(aggregate.maxPain).toBe(110); // argmin price, NOT the USD minimum amount.
    expect(aggregate.payout).toBe(20);
    expect(aggregate.curve).toEqual([
      { settlementPrice: 90, payout: 40 },
      { settlementPrice: 110, payout: 20 },
    ]);
  });
});
