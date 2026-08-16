export const VIEWER_PAGE_KEYS = ["dashboard", "positions", "matrix", "formulas", "dataSources"] as const;

export type ViewerPage = typeof VIEWER_PAGE_KEYS[number];
export type ViewerPagePermissions = Record<ViewerPage, boolean>;

export const DEFAULT_VIEWER_PAGE_PERMISSIONS: ViewerPagePermissions = {
  dashboard: false,
  positions: true,
  matrix: true,
  formulas: false,
  dataSources: false,
};

