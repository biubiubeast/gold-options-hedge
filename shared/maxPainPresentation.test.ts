import { describe, expect, it } from "vitest";
import {
  filterOiBooksByExpiryRange,
  getOiDistributionPresentation,
} from "./maxPainPresentation";
import {
  calculateMaxPain,
  mergeStrikeBooks,
  type GammaStrikeBook,
} from "./maxPainResearch";

describe("one-snapshot expiry range aggregation", () => {
  // Huge out-of-range inventory must not change any of the selected range values.
  const books: GammaStrikeBook[] = [
    {
      maturity: "2026-10-02",
      product: "inverse",
      strikes: [{ strike: 200, callOi: 0, putOi: 1000 }],
    },
    {
      maturity: "2026-09-25",
      product: "inverse",
      strikes: [{ strike: 110, callOi: 2, putOi: 2 }],
    },
    {
      maturity: "2026-09-11",
      product: "inverse",
      strikes: [{ strike: 50, callOi: 1000, putOi: 0 }],
    },
    {
      maturity: "2026-09-18",
      product: "inverse",
      strikes: [{ strike: 90, callOi: 1, putOi: 1 }],
    },
  ];
  it("includes both date boundaries, preserves the input and minimizes only selected maturities", () => {
    const original = structuredClone(books);
    const selected = filterOiBooksByExpiryRange(
      books,
      "2026-09-18",
      "2026-09-25"
    );
    expect(selected.error).toBeUndefined();
    expect(selected.books.map(b => b.maturity)).toEqual([
      "2026-09-18",
      "2026-09-25",
    ]);
    const rows = mergeStrikeBooks(selected.books);
    expect(rows.reduce((sum, row) => sum + row.callOi + row.putOi, 0)).toBe(6);
    // At S=90 the two puts at K=110 pay 40; at S=110 one call at K=90 pays 20.
    expect(calculateMaxPain(rows)).toEqual({
      maxPain: 110,
      payout: 20,
      curve: [
        { settlementPrice: 90, payout: 40 },
        { settlementPrice: 110, payout: 20 },
      ],
    });
    expect(books).toEqual(original);
    const single = filterOiBooksByExpiryRange(
      books,
      "2026-09-18",
      "2026-09-18"
    );
    expect(single.books).toHaveLength(1);
    expect(calculateMaxPain(mergeStrikeBooks(single.books))!.payout).toBe(0);
  });
  it("reports invalid or reversed ranges and leaves no-result ranges empty instead of reusing all expiries", () => {
    for (const [start, end] of [
      ["", "2026-09-25"],
      ["2026-02-30", "2026-09-25"],
      ["2026-09-25", "2026-09-18"],
      ["2026-09-18", "invalid"],
    ]) {
      const result = filterOiBooksByExpiryRange(books, start, end);
      expect(result.error).toBeTruthy();
      expect(result.books).toEqual([]);
    }
    const empty = filterOiBooksByExpiryRange(books, "2027-01-01", "2027-12-31");
    expect(empty).toEqual({ books: [] });
    expect(calculateMaxPain(mergeStrikeBooks(empty.books))).toBeNull();
  });
});

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
