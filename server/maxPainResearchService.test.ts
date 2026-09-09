import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregateHourlyKlines,
  buildStrikeBooks,
  fetchResearchReferencePrice,
  parseSignalPlusOption,
} from "./maxPainResearchService";
import type { ResearchKline } from "@shared/maxPainResearch";

afterEach(() => vi.unstubAllGlobals());

describe("Max Pain data adapters", () => {
  it("loads a single historical reference without requiring a month of candles", async () => {
    const timestamp = Date.parse("2026-08-31T16:00:00Z");
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          [timestamp / 1000, 78_000, 80_000, 78_561, 79_000, 1],
          [
            (timestamp - 3_600_000) / 1000,
            78_166.47,
            78_756.81,
            78_560.1,
            78_561.63,
            702.23452262,
          ],
        ])
      )
    );
    vi.stubGlobal("fetch", mockFetch);
    expect(await fetchResearchReferencePrice(timestamp)).toEqual({
      timestamp,
      price: 78_561.63,
      priceTimestamp: timestamp - 1,
      source: "Coinbase Exchange",
      symbol: "BTC-USD",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(Date.parse(url.searchParams.get("start")!)).toBe(
      timestamp - 3 * 3_600_000
    );
    expect(Date.parse(url.searchParams.get("end")!)).toBe(timestamp);
  });

  it("tries OKX when Coinbase supplies only a candle after the observation", async () => {
    const timestamp = Date.parse("2026-09-01T16:00:00Z");
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            [timestamp / 1000, 77_000, 79_000, 78_000, 78_500, 1],
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "0",
            data: [
              [
                String(timestamp - 3_600_000),
                "77800",
                "77900",
                "77700",
                "77850",
                "1",
                "1",
                "1",
                "1",
              ],
              [
                String(timestamp - 4 * 3_600_000),
                "77800",
                "77900",
                "77700",
                "77850",
                "1",
                "1",
                "1",
                "1",
              ],
            ],
          })
        )
      );
    vi.stubGlobal("fetch", mockFetch);
    expect(await fetchResearchReferencePrice(timestamp)).toMatchObject({
      price: 77_850,
      priceTimestamp: timestamp - 1,
      source: "OKX Spot",
      symbol: "BTC-USDT",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a missing reference missing after all sources fail and rejects future requests", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", mockFetch);
    await expect(
      fetchResearchReferencePrice(Date.parse("2026-08-30T16:00:00Z"))
    ).rejects.toThrow("BTC 参考价读取失败");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    await expect(
      fetchResearchReferencePrice(Date.now() + 86_400_000)
    ).rejects.toThrow("超出有效历史范围");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

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
