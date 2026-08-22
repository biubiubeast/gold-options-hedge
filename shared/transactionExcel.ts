import type { ImportedPosition, PositionUnderlying } from "./positionExcel";

export type TransactionSource = "KGI" | "BYBIT";

export type TransactionUnderlyingSummary = {
  underlying: PositionUnderlying;
  source: TransactionSource;
  sheetName: string;
  sourceAccount: string;
  venue: string;
  currency: "USD" | "USDT";
  referenceDate: string;
  tradeRows: number;
  ignoredRows: number;
  duplicateRows: number;
  openPositions: number;
  netQty: number;
  currentEntryCost: number;
  cumulativeEntryCost: number;
  cumulativeRealizedPnl: number;
};

export type TransactionExcelPreview = {
  fileName: string;
  sourceSheets: string[];
  accountingMethod: "MOVING_WEIGHTED_AVERAGE";
  positions: ImportedPosition[];
  summaries: TransactionUnderlyingSummary[];
  warnings: string[];
  errors: string[];
  summary: {
    sourceRows: number;
    tradeRows: number;
    ignoredRows: number;
    duplicateRows: number;
    openPositions: number;
    cumulativeEntryCost: number;
    cumulativeRealizedPnl: number;
  };
};
