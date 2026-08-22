import ExcelJS from "exceljs";
import {
  DEFAULT_GLD_CONTRACT_MULTIPLIER,
  DEFAULT_GLD_XAU_MULTIPLIER,
  DEFAULT_XAUT_CONTRACT_MULTIPLIER,
  DEFAULT_XAUT_XAU_MULTIPLIER,
} from "@shared/formulaEngine";
import { POSITION_SOURCE_DEFAULTS, type ImportedPosition, type PositionUnderlying } from "@shared/positionExcel";
import type {
  TransactionExcelPreview,
  TransactionSource,
  TransactionUnderlyingSummary,
} from "@shared/transactionExcel";

const EPSILON = 1e-9;
const MONTHS = new Map([
  ["JAN", 1], ["FEB", 2], ["MAR", 3], ["APR", 4], ["MAY", 5], ["JUN", 6],
  ["JUL", 7], ["AUG", 8], ["SEP", 9], ["OCT", 10], ["NOV", 11], ["DEC", 12],
]);

type ParseOptions = {
  gldMultiplierXau?: number;
  xautMultiplierXau?: number;
  gldContractMultiplier?: number;
  xautContractMultiplier?: number;
};

type InstrumentDefinition = {
  instrument: string;
  underlying: PositionUnderlying;
  expiry: string;
  strike: number;
  optionType: "call" | "put";
  currency: "USD" | "USDT";
  contractMultiplier: number;
};

type SourceSheet = {
  worksheet: ExcelJS.Worksheet;
  headerRow: number;
  source: TransactionSource;
  score: number;
};

type NormalizedTransaction = InstrumentDefinition & {
  source: TransactionSource;
  sheetName: string;
  sourceRow: number;
  eventAt: Date;
  type: string;
  side: "BUY" | "SELL";
  quantity: number;
  grossValue: number;
  feeCost: number;
  cashFlow: number;
  transactionId: string | null;
};

type Ledger = InstrumentDefinition & {
  source: TransactionSource;
  sheetName: string;
  netQty: number;
  entryValue: number;
  remainingFee: number;
  bookValue: number;
  cumulativeEntryCost: number;
  cumulativeRealizedPnl: number;
  firstRow: number;
};

const cleanText = (value: unknown): string => String(value ?? "").replace(/[\u3000\u00a0]/g, " ").trim();
const keyOf = (value: unknown): string => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(cleanText(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const numericString = (value: number | null, digits = 10): string | null => {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits)).toString();
};

function rawCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value as any;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if ("result" in value) return value.result;
  if ("error" in value) return value.error;
  if ("text" in value) return value.text;
  if (Array.isArray(value.richText)) return value.richText.map((part: any) => part.text).join("");
  return cell.text;
}

function excelDateTime(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
  }
  const text = cleanText(value);
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text)
    ? `${text.replace(" ", "T")}${text.includes("T") || text.includes(" ") ? "Z" : "T00:00:00Z"}`
    : text;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function reportDateFromFileName(fileName: string): Date | null {
  const candidates: Date[] = [];
  for (const match of fileName.matchAll(/(20\d{2})[_-]?(\d{2})[_-]?(\d{2})/g)) {
    const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime())) candidates.push(parsed);
  }
  return candidates.sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function parseInstrument(value: unknown): InstrumentDefinition | null {
  const instrument = cleanText(value);
  const match = instrument.match(/^(XAUT|GLD|BTC)-(\d{1,2})([A-Za-z]{3})(\d{2})-([0-9]+(?:\.[0-9]+)?)-([CP])-(USD|USDT)$/i);
  if (!match) return null;
  const month = MONTHS.get(match[3].toUpperCase());
  const strike = Number(match[5]);
  if (!month || !Number.isFinite(strike) || strike <= 0) return null;
  const underlying = match[1].toUpperCase() as PositionUnderlying;
  const expiry = `${2000 + Number(match[4])}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return {
    instrument,
    underlying,
    expiry,
    strike,
    optionType: match[6].toUpperCase() === "C" ? "call" : "put",
    currency: match[7].toUpperCase() === "USDT" ? "USDT" : "USD",
    contractMultiplier: underlying === "GLD" ? DEFAULT_GLD_CONTRACT_MULTIPLIER : underlying === "XAUT" ? DEFAULT_XAUT_CONTRACT_MULTIPLIER : 1,
  };
}

function sourceFromSheet(worksheet: ExcelJS.Worksheet, headerRow: number, headerMap: Map<string, number>): TransactionSource | null {
  const exchangeColumn = headerMap.get(keyOf("Exchange"));
  const instrumentColumn = headerMap.get(keyOf("Instrument"));
  for (let rowNumber = headerRow + 1; rowNumber <= Math.min(worksheet.rowCount, headerRow + 20); rowNumber += 1) {
    const exchange = exchangeColumn ? cleanText(rawCellValue(worksheet.getRow(rowNumber).getCell(exchangeColumn))).toUpperCase() : "";
    const instrument = instrumentColumn ? cleanText(rawCellValue(worksheet.getRow(rowNumber).getCell(instrumentColumn))).toUpperCase() : "";
    if (exchange.includes("KGI") || instrument.startsWith("GLD-")) return "KGI";
    if (exchange.includes("BYBIT") || instrument.startsWith("XAUT-") || instrument.startsWith("BTC-")) return "BYBIT";
  }
  const name = worksheet.name.toUpperCase();
  if (name.includes("KGI")) return "KGI";
  if (name.includes("BYBIT")) return "BYBIT";
  return null;
}

function sheetScore(worksheet: ExcelJS.Worksheet, source: TransactionSource): number {
  const name = worksheet.name.toUpperCase();
  let score = worksheet.rowCount;
  if (source === "BYBIT" && name.includes("RAW_BYBIT")) score += 10_000;
  if (source === "KGI" && worksheet.name === "全量_KGI_交易明细") score += 10_000;
  if (name.startsWith("原") || name.includes("ORIGINAL")) score -= 20_000;
  return score;
}

function findSourceSheets(workbook: ExcelJS.Workbook): SourceSheet[] {
  const candidates: SourceSheet[] = [];
  for (const worksheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const headers = Array.from({ length: Math.max(worksheet.columnCount, 12) }, (_, index) => cleanText(rawCellValue(row.getCell(index + 1))));
      const headerMap = new Map(headers.map((header, index) => [keyOf(header), index + 1]));
      const required = ["Date(UTC)", "Instrument", "Type", "Side", "Qty", "Price"];
      if (!required.every(header => headerMap.has(keyOf(header)))) continue;
      const source = sourceFromSheet(worksheet, rowNumber, headerMap);
      if (source) candidates.push({ worksheet, headerRow: rowNumber, source, score: sheetScore(worksheet, source) });
      break;
    }
  }
  return (["KGI", "BYBIT"] as const)
    .map(source => candidates.filter(candidate => candidate.source === source).sort((a, b) => b.score - a.score)[0])
    .filter((candidate): candidate is SourceSheet => Boolean(candidate));
}

function impliedFee(args: { type: string; side: "BUY" | "SELL"; grossValue: number; change: number | null; rawFee: number | null }): number {
  if (args.change !== null && args.type === "TRADE") {
    const implied = args.side === "BUY" ? -args.change - args.grossValue : args.grossValue - args.change;
    if (Number.isFinite(implied) && implied >= -0.01) return Math.max(0, implied);
  }
  return Math.abs(args.rawFee ?? 0);
}

function transactionCashFlow(args: {
  definition: InstrumentDefinition;
  type: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  grossValue: number;
  feeCost: number;
  change: number | null;
}): number {
  if (args.change !== null) return args.change;
  if (["DELIVERY", "EXERCISE", "SETTLEMENT"].includes(args.type)) {
    const intrinsicPerUnit = args.definition.optionType === "call"
      ? Math.max(args.price - args.definition.strike, 0)
      : Math.max(args.definition.strike - args.price, 0);
    const intrinsic = intrinsicPerUnit * args.quantity * args.definition.contractMultiplier;
    return (args.side === "SELL" ? intrinsic : -intrinsic) - args.feeCost;
  }
  return args.side === "BUY" ? -args.grossValue - args.feeCost : args.grossValue - args.feeCost;
}

function ledgerKey(transaction: Pick<NormalizedTransaction, "source" | "instrument">): string {
  return `${transaction.source}|${transaction.instrument.toUpperCase()}`;
}

function applyTransaction(ledger: Ledger, transaction: NormalizedTransaction, errors: string[]) {
  const signedQty = transaction.side === "BUY" ? transaction.quantity : -transaction.quantity;
  if (Math.abs(ledger.netQty) <= EPSILON || Math.sign(ledger.netQty) === Math.sign(signedQty)) {
    if (transaction.type !== "TRADE" && Math.abs(ledger.netQty) <= EPSILON) {
      errors.push(`${transaction.sheetName} 第 ${transaction.sourceRow} 行 ${transaction.instrument}：发现没有期初仓位的 ${transaction.type}，无法可靠计算成本`);
      return;
    }
    ledger.netQty += signedQty;
    ledger.entryValue += Math.sign(signedQty) * transaction.grossValue;
    ledger.remainingFee += transaction.feeCost;
    ledger.bookValue += -transaction.cashFlow;
    ledger.cumulativeEntryCost += -transaction.cashFlow;
    return;
  }

  const transactionQty = Math.abs(signedQty);
  const existingQty = Math.abs(ledger.netQty);
  const closeQty = Math.min(transactionQty, existingQty);
  const closeRatioOfPosition = closeQty / existingQty;
  const closeRatioOfTransaction = closeQty / transactionQty;
  const allocatedBookValue = ledger.bookValue * closeRatioOfPosition;
  const closeCashFlow = transaction.cashFlow * closeRatioOfTransaction;
  ledger.cumulativeRealizedPnl += closeCashFlow - allocatedBookValue;
  ledger.netQty += Math.sign(signedQty) * closeQty;
  ledger.entryValue *= 1 - closeRatioOfPosition;
  ledger.remainingFee *= 1 - closeRatioOfPosition;
  ledger.bookValue -= allocatedBookValue;

  const remainingQty = transactionQty - closeQty;
  if (remainingQty <= EPSILON) {
    if (Math.abs(ledger.netQty) <= EPSILON) {
      ledger.netQty = 0;
      ledger.entryValue = 0;
      ledger.remainingFee = 0;
      ledger.bookValue = 0;
    }
    return;
  }
  if (transaction.type !== "TRADE") {
    errors.push(`${transaction.sheetName} 第 ${transaction.sourceRow} 行 ${transaction.instrument}：${transaction.type} 数量超过账面仓位`);
    return;
  }
  const openRatio = remainingQty / transactionQty;
  const openCashFlow = transaction.cashFlow * openRatio;
  const openGrossValue = transaction.grossValue * openRatio;
  const openFee = transaction.feeCost * openRatio;
  ledger.netQty = Math.sign(signedQty) * remainingQty;
  ledger.entryValue = Math.sign(signedQty) * openGrossValue;
  ledger.remainingFee = openFee;
  ledger.bookValue = -openCashFlow;
  ledger.cumulativeEntryCost += -openCashFlow;
}

function toImportedPosition(ledger: Ledger, referenceDate: string, options: ParseOptions, fileName: string): ImportedPosition {
  const multiplierXau = ledger.underlying === "GLD"
    ? options.gldMultiplierXau ?? DEFAULT_GLD_XAU_MULTIPLIER
    : ledger.underlying === "XAUT"
      ? options.xautMultiplierXau ?? DEFAULT_XAUT_XAU_MULTIPLIER
      : null;
  const entryPrice = Math.abs(ledger.entryValue / (ledger.netQty * ledger.contractMultiplier));
  const sourceDefaults = POSITION_SOURCE_DEFAULTS[ledger.underlying];
  return {
    underlying: ledger.underlying,
    expiry: ledger.expiry,
    strike: numericString(ledger.strike, 6)!,
    optionType: ledger.optionType,
    entryPrice: numericString(entryPrice)!,
    quantity: numericString(ledger.netQty)!,
    fee: numericString(ledger.remainingFee)!,
    entryDelta: "",
    sourceAccount: sourceDefaults.sourceAccount,
    venue: sourceDefaults.venue,
    instrument: ledger.instrument,
    product: `${ledger.underlying} Option`,
    currency: ledger.currency,
    qtyLong: numericString(Math.max(ledger.netQty, 0)),
    qtyShort: numericString(Math.max(-ledger.netQty, 0)),
    multiplierXau: numericString(multiplierXau),
    xauEqNetQty: multiplierXau === null ? null : numericString(ledger.netQty * ledger.contractMultiplier * multiplierXau),
    referenceDate,
    importedMarkPrice: null,
    importedMarketValue: null,
    entryValue: numericString(ledger.entryValue),
    importedEntryCost: numericString(ledger.bookValue),
    importedUnrealizedPnl: null,
    importedUnrealizedPnlPct: null,
    importedTotalDeltaXau: null,
    importedTotalGammaXau: null,
    importedTotalThetaUsdDay: null,
    importedTotalVegaUsdVol: null,
    unitGamma: null,
    unitTheta: null,
    unitVega: null,
    contractMultiplier: numericString(ledger.contractMultiplier),
    cumulativeEntryCost: numericString(ledger.cumulativeEntryCost),
    cumulativeRealizedPnl: numericString(ledger.cumulativeRealizedPnl),
    rawMarginMode: ledger.underlying === "XAUT" ? "Cross" : "Cash/Listed Options",
    rawMarginType: ledger.underlying === "XAUT" ? "USDT-M" : "USD",
    importSource: `${fileName} · ${ledger.sheetName}`,
    importRow: ledger.firstRow,
    dataStatus: "MISSING",
  };
}

export async function parseTransactionWorkbook(
  buffer: Buffer,
  fileName: string,
  options: ParseOptions = {},
): Promise<TransactionExcelPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sourceSheets = findSourceSheets(workbook);
  const warnings: string[] = [];
  const errors: string[] = [];
  const transactions: NormalizedTransaction[] = [];
  const sourceStats = new Map<TransactionSource, { ignoredRows: number; duplicateRows: number; seenIds: Set<string> }>();

  if (!sourceSheets.length) {
    return {
      fileName,
      sourceSheets: [],
      accountingMethod: "MOVING_WEIGHTED_AVERAGE",
      positions: [],
      summaries: [],
      warnings,
      errors: ["未找到全量交易明细：需要 Date(UTC)、Instrument、Type、Side、Qty、Price 列"],
      summary: { sourceRows: 0, tradeRows: 0, ignoredRows: 0, duplicateRows: 0, openPositions: 0, cumulativeEntryCost: 0, cumulativeRealizedPnl: 0 },
    };
  }

  for (const candidate of sourceSheets) {
    const { worksheet, headerRow, source } = candidate;
    const headers = Array.from({ length: worksheet.columnCount }, (_, index) => cleanText(rawCellValue(worksheet.getRow(headerRow).getCell(index + 1))));
    const headerMap = new Map(headers.map((header, index) => [keyOf(header), index + 1]));
    const column = (header: string) => headerMap.get(keyOf(header));
    const stats = { ignoredRows: 0, duplicateRows: 0, seenIds: new Set<string>() };
    sourceStats.set(source, stats);
    for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const read = (header: string) => {
        const index = column(header);
        return index ? rawCellValue(row.getCell(index)) : null;
      };
      const instrumentValue = read("Instrument");
      const type = cleanText(read("Type")).toUpperCase();
      const hasSourceData = Boolean(cleanText(read("Date(UTC)")) || cleanText(instrumentValue) || type);
      if (!hasSourceData) continue;
      const parsedDefinition = parseInstrument(instrumentValue);
      const definition = parsedDefinition ? {
        ...parsedDefinition,
        contractMultiplier: parsedDefinition.underlying === "GLD"
          ? options.gldContractMultiplier ?? parsedDefinition.contractMultiplier
          : parsedDefinition.underlying === "XAUT"
            ? options.xautContractMultiplier ?? parsedDefinition.contractMultiplier
            : parsedDefinition.contractMultiplier,
      } : null;
      const sideText = cleanText(read("Side")).toUpperCase();
      const quantityRaw = finite(read("Qty"));
      const price = finite(read("Price"));
      const eventAt = excelDateTime(read("Date(UTC)"));
      if (!definition || (sideText !== "BUY" && sideText !== "SELL") || quantityRaw === null || quantityRaw <= 0 || price === null || eventAt === null) {
        stats.ignoredRows += 1;
        if (definition) warnings.push(`${worksheet.name} 第 ${rowNumber} 行 ${definition.instrument}：交易方向、数量、价格或时间不完整，已忽略`);
        continue;
      }
      if ((source === "KGI" && definition.underlying !== "GLD") || (source === "BYBIT" && !["XAUT", "BTC"].includes(definition.underlying))) {
        stats.ignoredRows += 1;
        warnings.push(`${worksheet.name} 第 ${rowNumber} 行 ${definition.instrument}：来源与标的不匹配，已忽略`);
        continue;
      }
      const quantity = source === "KGI" && definition.underlying === "GLD"
        ? quantityRaw / definition.contractMultiplier
        : quantityRaw;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        stats.ignoredRows += 1;
        continue;
      }
      const transactionId = [read("TradeId"), read("BillId")].map(cleanText).find(Boolean) ?? null;
      if (transactionId) {
        const uniqueId = `${source}|${transactionId}`;
        if (stats.seenIds.has(uniqueId)) {
          stats.duplicateRows += 1;
          warnings.push(`${worksheet.name} 第 ${rowNumber} 行：重复交易 ID ${transactionId}，已跳过`);
          continue;
        }
        stats.seenIds.add(uniqueId);
      }
      const side = sideText as "BUY" | "SELL";
      const normalizedType = type || "TRADE";
      const grossValue = quantity * price * definition.contractMultiplier;
      const change = finite(read("Change"));
      const feeCost = impliedFee({ type: normalizedType, side, grossValue, change, rawFee: finite(read("Fee")) });
      const cashFlow = transactionCashFlow({ definition, type: normalizedType, side, quantity, price, grossValue, feeCost, change });
      transactions.push({
        ...definition,
        source,
        sheetName: worksheet.name,
        sourceRow: rowNumber,
        eventAt,
        type: normalizedType,
        side,
        quantity,
        grossValue,
        feeCost,
        cashFlow,
        transactionId,
      });
    }
  }

  transactions.sort((left, right) => left.eventAt.getTime() - right.eventAt.getTime() || left.sourceRow - right.sourceRow);
  const ledgers = new Map<string, Ledger>();
  for (const transaction of transactions) {
    const key = ledgerKey(transaction);
    let ledger = ledgers.get(key);
    if (!ledger) {
      ledger = {
        instrument: transaction.instrument,
        underlying: transaction.underlying,
        expiry: transaction.expiry,
        strike: transaction.strike,
        optionType: transaction.optionType,
        currency: transaction.currency,
        contractMultiplier: transaction.contractMultiplier,
        source: transaction.source,
        sheetName: transaction.sheetName,
        netQty: 0,
        entryValue: 0,
        remainingFee: 0,
        bookValue: 0,
        cumulativeEntryCost: 0,
        cumulativeRealizedPnl: 0,
        firstRow: transaction.sourceRow,
      };
      ledgers.set(key, ledger);
    }
    applyTransaction(ledger, transaction, errors);
  }

  const latestByUnderlying = new Map<PositionUnderlying, Date>();
  const reportDate = reportDateFromFileName(fileName);
  for (const transaction of transactions) {
    const current = latestByUnderlying.get(transaction.underlying);
    if (!current || transaction.eventAt > current) latestByUnderlying.set(transaction.underlying, transaction.eventAt);
  }
  if (reportDate) {
    for (const underlying of new Set(transactions.map(transaction => transaction.underlying))) {
      const current = latestByUnderlying.get(underlying);
      if (!current || reportDate > current) latestByUnderlying.set(underlying, reportDate);
    }
  }
  for (const ledger of ledgers.values()) {
    const reference = latestByUnderlying.get(ledger.underlying);
    if (reference && ledger.expiry < reference.toISOString().slice(0, 10) && Math.abs(ledger.netQty) > EPSILON) {
      errors.push(`${ledger.instrument} 已到期但仍有 Net Qty ${Number(ledger.netQty.toFixed(10))}；请补齐到期/交割记录`);
    }
  }

  const positions = [...ledgers.values()]
    .filter(ledger => Math.abs(ledger.netQty) > EPSILON)
    .map(ledger => toImportedPosition(
      ledger,
      latestByUnderlying.get(ledger.underlying)?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      options,
      fileName,
    ))
    .sort((left, right) => left.underlying.localeCompare(right.underlying) || left.expiry.localeCompare(right.expiry) || Number(left.strike) - Number(right.strike));

  const underlyings = [...new Set(transactions.map(transaction => transaction.underlying))];
  const summaries: TransactionUnderlyingSummary[] = underlyings.map(underlying => {
    const underlyingLedgers = [...ledgers.values()].filter(ledger => ledger.underlying === underlying);
    const underlyingPositions = positions.filter(position => position.underlying === underlying);
    const source = underlyingLedgers[0]?.source ?? (underlying === "GLD" ? "KGI" : "BYBIT");
    const stats = sourceStats.get(source) ?? { ignoredRows: 0, duplicateRows: 0 };
    const defaults = POSITION_SOURCE_DEFAULTS[underlying];
    return {
      underlying,
      source,
      sheetName: underlyingLedgers[0]?.sheetName ?? "MISSING",
      sourceAccount: defaults.sourceAccount,
      venue: defaults.venue,
      currency: underlying === "GLD" ? "USD" : "USDT",
      referenceDate: latestByUnderlying.get(underlying)?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      tradeRows: transactions.filter(transaction => transaction.underlying === underlying).length,
      ignoredRows: stats.ignoredRows,
      duplicateRows: stats.duplicateRows,
      openPositions: underlyingPositions.length,
      netQty: underlyingPositions.reduce((sum, position) => sum + Number(position.quantity), 0),
      currentEntryCost: underlyingPositions.reduce((sum, position) => sum + Number(position.importedEntryCost ?? 0), 0),
      cumulativeEntryCost: underlyingLedgers.reduce((sum, ledger) => sum + ledger.cumulativeEntryCost, 0),
      cumulativeRealizedPnl: underlyingLedgers.reduce((sum, ledger) => sum + ledger.cumulativeRealizedPnl, 0),
    };
  });

  return {
    fileName,
    sourceSheets: sourceSheets.map(candidate => candidate.worksheet.name),
    accountingMethod: "MOVING_WEIGHTED_AVERAGE",
    positions,
    summaries,
    warnings,
    errors: [...new Set(errors)],
    summary: {
      sourceRows: transactions.length + [...sourceStats.values()].reduce((sum, stats) => sum + stats.ignoredRows + stats.duplicateRows, 0),
      tradeRows: transactions.length,
      ignoredRows: [...sourceStats.values()].reduce((sum, stats) => sum + stats.ignoredRows, 0),
      duplicateRows: [...sourceStats.values()].reduce((sum, stats) => sum + stats.duplicateRows, 0),
      openPositions: positions.length,
      cumulativeEntryCost: summaries.reduce((sum, summary) => sum + summary.cumulativeEntryCost, 0),
      cumulativeRealizedPnl: summaries.reduce((sum, summary) => sum + summary.cumulativeRealizedPnl, 0),
    },
  };
}
