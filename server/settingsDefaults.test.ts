import { describe, expect, it } from "vitest";
import { DEFAULT_PORTFOLIO_SETTINGS } from "../client/src/lib/portfolio";
import { DEFAULT_VIEWER_PAGE_PERMISSIONS } from "../shared/access";

describe("operator display defaults", () => {
  it("limits xauwhales to positions and the risk heatmap by default", () => {
    expect(DEFAULT_VIEWER_PAGE_PERMISSIONS).toEqual({
      dashboard: false,
      positions: true,
      matrix: true,
      formulas: false,
      dataSources: false,
    });
  });

  it("keeps only the global market refresh button visible by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.pageMarketRefreshButtons).toEqual({
      positions: false,
      matrix: false,
    });
  });

  it("keeps heatmap click-through detail dialogs disabled by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapClickActions).toEqual({
      cellDetail: false,
      expiryDetail: false,
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
