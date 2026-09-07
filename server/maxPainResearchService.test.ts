import { describe, expect, it } from "vitest";
import {
  aggregateHourlyKlines,
  buildStrikeBooks,
  parseSignalPlusOption,
} from "./maxPainResearchService";
import type { ResearchKline } from "@shared/maxPainResearch";

describe("Max Pain data adapters", () => {
  it("parses BTC-settled and USDC-settled Deribit-style option names", () => {
    expect(
      parseSignalPlusOption({
        instrument_name: "BTC-29AUG26-90000-C",
        type: "OPTION",
        open_interest: 12.5,
        ts: 1,
      })
    ).toMatchObject({
      maturity: "2026-08-29",
      strike: 90_000,
      side: "call",
      product: "inverse",
    });
    expect(
      parseSignalPlusOption({
        instrument_name: "BTC_USDC-29AUG26-90000-P",
        type: "OPTION",
        open_interest: 3,
        ts: 1,
      })
    ).toMatchObject({ side: "put", product: "linear" });
  });

  it("keeps BTC-settled and USDC-settled expiry books separate", () => {
    const rows = [
      parseSignalPlusOption({
        instrument_name: "BTC-29AUG26-90000-C",
        type: "OPTION",
        open_interest: 12.5,
        ts: 1,
      }),
      parseSignalPlusOption({
        instrument_name: "BTC_USDC-29AUG26-90000-P",
        type: "OPTION",
        open_interest: 3,
        ts: 1,
      }),
    ].filter(row => row !== null);
    const books = buildStrikeBooks(rows);
    expect(books).toHaveLength(2);
    expect(books.find(book => book.product === "inverse")?.strikes).toEqual([
      { strike: 90_000, callOi: 12.5, putOi: 0 },
    ]);
    expect(books.find(book => book.product === "linear")?.strikes).toEqual([
      { strike: 90_000, callOi: 0, putOi: 3 },
    ]);
  });

  it("aggregates provider-neutral hourly candles on UTC boundaries", () => {
    const start = Date.parse("2026-08-20T00:00:00Z");
    const hourly: ResearchKline[] = Array.from({ length: 4 }, (_, index) => ({
      openTime: start + index * 3_600_000,
      closeTime: start + (index + 1) * 3_600_000 - 1,
      open: 100 + index,
      high: 104 + index,
      low: 98 - index,
      close: 101 + index,
      volume: index + 1,
    }));
    expect(
      aggregateHourlyKlines(hourly, start, start + 4 * 3_600_000 - 1, "4h")
    ).toEqual([
      {
        openTime: start,
        closeTime: start + 4 * 3_600_000 - 1,
        open: 100,
        high: 107,
        low: 95,
        close: 104,
        volume: 10,
      },
    ]);
  });
});
