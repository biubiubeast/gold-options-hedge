import { describe, expect, it } from "vitest";
import { DEFAULT_PORTFOLIO_SETTINGS } from "../client/src/lib/portfolio";

describe("operator display defaults", () => {
  it("requires admin access everywhere except the risk heatmap by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.adminPasswordPages.matrix).toBe(false);
    expect(Object.entries(DEFAULT_PORTFOLIO_SETTINGS.adminPasswordPages)
      .filter(([page]) => page !== "matrix")
      .every(([, enabled]) => enabled)).toBe(true);
  });

  it("keeps only the global market refresh button visible by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.pageMarketRefreshButtons).toEqual({
      positions: false,
      matrix: false,
    });
  });

  it("hides the heatmap chain and position-only hint rows by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapVisibleSections.chainStatusBanner).toBe(false);
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapVisibleSections.positionOnlyMetricBanner).toBe(false);
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapVisibleSections.chainContractCount).toBe(false);
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapChainContractCountLabel).toContain("Call + Put");
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapChainContractCountLabel).toContain("筛选前");
  });

  it("hides the ALL underlying option by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.underlying).toEqual({
      GLD: true,
      XAUT: true,
      BTC: true,
      all: false,
    });
  });
});
