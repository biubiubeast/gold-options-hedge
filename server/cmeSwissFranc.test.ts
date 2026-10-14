import { describe, expect, it } from "vitest";
import {
  cmeExpiryTimestamp,
  cmeNumber,
  getCmePublicSixSChain,
  normalizeCmeReferenceSeries,
} from "./cmeSwissFranc";
import { normalizeSixSGatewayChain } from "./marketData";
import { buildChainRiskPositions } from "../client/src/lib/riskHeatmapAdapter";
import {
  enrichRiskPositions,
  metricDistribution,
  formatInstrumentPrice,
  metricSelectorLabel,
} from "../shared/riskHeatmap";

const now = Date.parse("2026-10-14T12:00:00Z");
const fixtures = {
  chain: {
    tradeDate: "13 Oct 2026",
    strikePrices: [
      {
        strikePrice: "1.21",
        underlyingFutureContract: "6SZ6",
        call: {
          quoteCode: "CHUX6 C1210",
          priorSettle: "0.0081",
          volume: "0",
          updated: "2026-10-14T01:45:25Z",
        },
        put: {
          quoteCode: "CHUX6 P1210",
          priorSettle: "0.0082",
          volume: "3",
          updated: "2026-10-14T01:45:25Z",
        },
      },
    ],
  },
  settlements: {
    tradeDate: "10/13/2026",
    settlements: [
      { month: "DEC 26", settle: "1.2098", volume: "18000" },
      { month: "MAR 27", settle: "1.2235", volume: "32" },
    ],
  },
};

describe("CME Swiss franc reference chain", () => {
  it("parses missing versus genuine zero and quote suffixes", () => {
    expect(cmeNumber("-")).toBeNull();
    expect(cmeNumber("0")).toBe(0);
    expect(cmeNumber("18,401")).toBe(18401);
    expect(cmeNumber("1.20980B")).toBe(1.2098);
    expect(formatInstrumentPrice(0.0081, "6Smain")).toBe("0.00810");
    expect(formatInstrumentPrice(null, "6Smain")).toBe("MISSING");
    expect(metricSelectorLabel("volume", "6Smain")).toBe("Volume (Session)");
  });
  it("uses Chicago DST for the exact 09:00 expiry cutoff", () => {
    expect(cmeExpiryTimestamp("2026-10-16")).toBe(
      Date.parse("2026-10-16T14:00:00Z")
    );
    expect(cmeExpiryTimestamp("2026-12-04")).toBe(
      Date.parse("2026-12-04T15:00:00Z")
    );
  });
  it("keeps settlement dates and each actual futures maturity; no synthetic BBO", () => {
    const deferred = {
      ...fixtures.chain,
      strikePrices: fixtures.chain.strikePrices.map(row => ({
        ...row,
        underlyingFutureContract: "6SH7",
      })),
    };
    const rows = normalizeCmeReferenceSeries({
      chain: deferred,
      productCode: "CHUX26",
      expiry: "2026-11-06",
      settlements: fixtures.settlements,
      now,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      bid1Price: null,
      ask1Price: null,
      markPriceKind: "settlement",
      ivReferenceSpot: 1.2235,
    });
    expect(rows[0].timestamp).toBe(Date.parse("2026-10-13T12:00:00Z"));
    expect(rows[0].timestamp).not.toBe(
      Date.parse(deferred.strikePrices[0].call.updated)
    );
    const wrongDate = normalizeCmeReferenceSeries({
      chain: deferred,
      productCode: "CHUX26",
      expiry: "2026-11-06",
      settlements: { ...fixtures.settlements, tradeDate: "10/12/2026" },
      now,
    });
    expect(wrongDate[0].ivReferenceSpot).toBeNull();
  });
  it("carries a real chain through the adapter into colored metric samples and preserves missing IV", () => {
    const rawQuotes = normalizeCmeReferenceSeries({
      ...fixtures,
      productCode: "CHUX26",
      expiry: "2026-11-06",
      now,
    });
    const chain = normalizeSixSGatewayChain({
      quotes: rawQuotes,
      spot: 1.2081,
      timestamp: rawQuotes[0].timestamp,
      feedKind: "delayed-reference",
    });
    expect(chain.status).toBe("delayed");
    expect(chain.quotes[0].modelMarkIv).toBeGreaterThan(0);
    expect(chain.quotes[0].modelBidIv).toBeNull();
    const risk = buildChainRiskPositions(
      chain.quotes,
      "6Smain",
      null,
      125_000,
      { venue: "CME" }
    );
    const spots = {
      GLD: 400,
      XAUT: 4500,
      BTC: 100000,
      ETH: 4000,
      "6Smain": 1.2081,
    };
    const enriched = enrichRiskPositions(risk, spots, new Date(now));
    expect(metricDistribution(enriched, "modelMarkIV").validCount).toBe(2);
    expect(metricDistribution(enriched, "modelIVSpread").validCount).toBe(0);
    expect(enriched[0].bid).toBeNull();
    expect(enriched[0].bidDollarNotional).toBeNull();
    const missing = normalizeSixSGatewayChain({
      quotes: [{ ...rawQuotes[0], ivReferenceSpot: null }],
      spot: 1.2081,
      feedKind: "delayed-reference",
    });
    expect(missing.quotes[0].modelMarkIv).toBeNull();
    expect(missing.quotes[0].delta).toBeNull();
    const missingRisk = enrichRiskPositions(
      buildChainRiskPositions(missing.quotes, "6Smain", null, 125_000),
      spots,
      new Date(now)
    );
    expect(missingRisk[0].modelMarkIV).toBeNull();
    expect(missingRisk[0].unitDelta).toBeNull();
  });
  it("loads only real, active monthly and weekly expiries and reports partial chain failures", async () => {
    const entries = [
      {
        productCode: "CHUV26",
        firstTrade: "06 Oct 2025",
        lastTrade: "09 Oct 2026",
        contractMonth: "Oct 2026",
      },
      {
        productCode: "CHUX26",
        firstTrade: "10 Nov 2025",
        lastTrade: "06 Nov 2026",
        contractMonth: "Nov 2026",
      },
      {
        productCode: "CHUZ26",
        firstTrade: "09 Dec 2024",
        lastTrade: "04 Dec 2026",
        contractMonth: "Dec 2026",
      },
      {
        productCode: "CHUF27",
        firstTrade: "01 Jan 2027",
        lastTrade: "08 Jan 2027",
        contractMonth: "Jan 2027",
      },
    ];
    const paths: string[] = [];
    const pull = async <T>(path: string): Promise<T> => {
      paths.push(path);
      if (path.startsWith("ProductCalendar"))
        return [{ productId: 8110, calendarEntries: entries }] as T;
      if (path.includes("/2026/12/")) throw new Error("CME temporary outage");
      if (path.startsWith("atm/")) return fixtures.chain as T;
      return fixtures.settlements as T;
    };
    const chain = await getCmePublicSixSChain(now, pull);
    expect(chain.requestedExpiryCount).toBe(2);
    expect(chain.loadedExpiryCount).toBe(1);
    expect(chain.warnings).toHaveLength(1);
    expect(paths.some(path => path.includes("/2026/10/"))).toBe(false);
    expect(paths.some(path => path.includes("/2027/1/"))).toBe(false);
  });
});
