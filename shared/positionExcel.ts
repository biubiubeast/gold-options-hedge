export const POSITION_EXCEL_HEADERS = [
  "Source Account",
  "Venue",
  "Instrument",
  "Underlying",
  "Product",
  "Expiry",
  "Strike",
  "Call/Put",
  "Currency",
  "Qty Long",
  "Qty Short",
  "Net Qty",
  "Multiplier XAU",
  "XAU Eq Net Qty",
  "Reference Date",
  "Mark Price",
  "Avg/Entry Price",
  "Market Value",
  "Entry Value",
  "Fee",
  "Entry Cost",
  "Unrealized PnL",
  "Unrealized PnL%",
  "BS Delta XAU",
  "Gamma",
  "Theta USD/day",
  "Vega USD/vol",
  "Raw Margin Mode",
  "Raw Margin Type",
] as const;

export type ImportMode = "replace" | "upsert";

export type ImportedPosition = {
  underlying: "XAUT" | "GLD" | "BTC";
  expiry: string;
  strike: string;
  optionType: "call" | "put";
  entryPrice: string;
  quantity: string;
  fee: string;
  entryDelta: string;
  sourceAccount: string | null;
  venue: string | null;
  instrument: string;
  product: string | null;
  currency: "USD" | "USDT";
  qtyLong: string | null;
  qtyShort: string | null;
  multiplierXau: string | null;
  xauEqNetQty: string | null;
  referenceDate: string | null;
  importedMarkPrice: string | null;
  importedMarketValue: string | null;
  entryValue: string | null;
  importedEntryCost: string | null;
  importedUnrealizedPnl: string | null;
  importedUnrealizedPnlPct: string | null;
  importedTotalDeltaXau: string | null;
  importedTotalGammaXau: string | null;
  importedTotalThetaUsdDay: string | null;
  importedTotalVegaUsdVol: string | null;
  unitGamma: string | null;
  unitTheta: string | null;
  unitVega: string | null;
  contractMultiplier: string | null;
  rawMarginMode: string | null;
  rawMarginType: string | null;
  importSource: string | null;
  importRow: number | null;
  dataStatus: "LIVE" | "STALE" | "WARN" | "MISSING" | "FAIL";
};

export type PositionExcelTotal = {
  underlying: "XAUT" | "GLD" | "BTC";
  netQty: number | null;
  xauEqNetQty: number | null;
  entryCost: number | null;
  marketValue: number | null;
  totalDeltaXau: number | null;
  totalGammaXau: number | null;
  totalThetaUsdDay: number | null;
  totalVegaUsdVol: number | null;
};

export type PositionExcelPreview = {
  fileName: string;
  sheetName: string;
  title: string;
  headerRow: number;
  headers: string[];
  exactHeaderMatch: boolean;
  positions: ImportedPosition[];
  totals: PositionExcelTotal[];
  warnings: string[];
  errors: string[];
  referenceDate: string | null;
  summary: {
    detailRows: number;
    totalRows: number;
    xautRows: number;
    gldRows: number;
    btcRows: number;
    xautNetQty: number;
    gldNetQty: number;
    btcNetQty: number;
  };
};
