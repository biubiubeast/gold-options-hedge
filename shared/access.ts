export const VIEWER_PAGE_KEYS = [
  "dashboard",
  "positions",
  "matrix",
  "tradingView",
  "maxPain",
  "formulas",
  "dataSources",
] as const;

export type ViewerPage = (typeof VIEWER_PAGE_KEYS)[number];
export type ViewerPagePermissions = Record<ViewerPage, boolean>;

export const DEFAULT_VIEWER_PAGE_PERMISSIONS: ViewerPagePermissions = {
  dashboard: false,
  positions: true,
  matrix: true,
  tradingView: true,
  maxPain: true,
  formulas: false,
  dataSources: false,
};

export const MAX_PAIN_SECTION_KEYS = [
  "chart",
  "oiDistribution",
  "details",
  "backtest",
  "gammaZone",
  "methodology",
] as const;

export type MaxPainVisibleSections = Record<
  (typeof MAX_PAIN_SECTION_KEYS)[number],
  boolean
>;

export const DEFAULT_MAX_PAIN_VISIBLE_SECTIONS: MaxPainVisibleSections = {
  chart: true,
  oiDistribution: true,
  details: true,
  backtest: false,
  gammaZone: false,
  methodology: true,
};
