import { describe, expect, it } from "vitest";
import { DEFAULT_HEATMAP_VIEW, DEFAULT_PORTFOLIO_SETTINGS, DEFAULT_VIEWER_HEATMAP_HELD_CELL_CONTENT } from "../client/src/lib/portfolio";
import { DEFAULT_VIEWER_PAGE_PERMISSIONS } from "../shared/access";

describe("operator display defaults", () => {
  it("opens the heatmap with the operator's common GLD volatility view", () => {
    expect(DEFAULT_HEATMAP_VIEW).toEqual({
      underlying: "GLD",
      moneyness: "otm",
      callPut: "combined",
      metric: "ivSpread",
      labelMode: "held",
      hoverPreset: "all",
    });
  });

  it("lets xauwhales use positions, the market heatmap, and TradingView by default", () => {
    expect(DEFAULT_VIEWER_PAGE_PERMISSIONS).toEqual({
      dashboard: false,
      positions: true,
      matrix: true,
      tradingView: true,
      formulas: false,
      dataSources: false,
    });
  });

  it("hides every held-cell identification code for xauwhales", () => {
    expect(DEFAULT_VIEWER_HEATMAP_HELD_CELL_CONTENT).toEqual({
      underlying: false,
      callPut: false,
      dataStatus: false,
    });
  });

  it("keeps only the global market refresh button visible by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.pageMarketRefreshButtons).toEqual({
      positions: false,
      matrix: false,
    });
  });

  it("hides the positions persistence hint and PNL hover preset by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.positionsVisibleSections.marketPersistenceHint).toBe(false);
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.hover.pnl).toBe(false);
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
      BTC_DERIBIT: true,
      ETH_BYBIT: true,
      ETH_DERIBIT: true,
      all: false,
    });
  });

  it("shows the ITM/OTM filter with all three choices enabled by default", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapVisibleFilters.moneyness).toBe(true);
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.moneyness).toEqual({
      all: true,
      itm: true,
      otm: true,
    });
  });

  it("keeps the trading filters visible on the initial heatmap screen", () => {
    const visible = DEFAULT_PORTFOLIO_SETTINGS.heatmapVisibleFilters;
    expect({
      underlying: visible.underlying,
      callPut: visible.callPut,
      metric: visible.metric,
      moneyness: visible.moneyness,
      label: visible.label,
      hover: visible.hover,
      range: visible.range,
      cellSize: visible.cellSize,
      fullscreen: visible.fullscreen,
    }).toEqual({
      underlying: true,
      callPut: true,
      metric: true,
      moneyness: true,
      label: true,
      hover: true,
      range: true,
      cellSize: true,
      fullscreen: true,
    });
  });

  it("enables the combined Call + Put choice for the OTM-only workflow", () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.callPut).toEqual({
      call: true,
      put: true,
      combined: true,
    });
  });
});
