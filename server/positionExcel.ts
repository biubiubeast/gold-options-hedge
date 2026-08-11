import ExcelJS from "exceljs";
import {
  POSITION_EXCEL_HEADERS,
  type ImportedPosition,
  type PositionExcelPreview,
  type PositionExcelTotal,
} from "@shared/positionExcel";
import type { PositionRecord } from "./db";

const ERROR_TOKENS = new Set(["#REF!", "#NAME?", "#N/A", "#VALUE!", "#DIV/0!", "#NUM!"]);
const cleanText = (value: unknown): string => String(value ?? "").replace(/[\u3000\u00a0]/g, " ").trim();
const keyOf = (value: unknown) => cleanText(value).toLowerCase().replace(/[^a-z0-9%]+/g, "");

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

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = cleanText(value).replace(/,/g, "");
  if (!text || ERROR_TOKENS.has(text.toUpperCase())) return null;
  const parsed = Number(text.replace(/%$/, ""));
  if (!Number.isFinite(parsed)) return null;
  return text.endsWith("%") ? parsed / 100 : parsed;
}

function numericString(value: number | null, digits = 10): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits)).toString();
}

function excelDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const text = cleanText(value);
  if (!text || ERROR_TOKENS.has(text.toUpperCase())) return null;
  const iso = text.match(/^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function normalizeUnderlying(value: unknown, instrument: string): "XAUT" | "GLD" | null {
  const text = `${cleanText(value)} ${instrument}`.toUpperCase();
  if (text.includes("XAUT")) return "XAUT";
  if (text.includes("GLD") || text.includes("SPDR GOLD SHARES")) return "GLD";
  return null;
}

function normalizeCallPut(value: unknown, instrument: string): "call" | "put" | null {
  const text = `${cleanText(value)} ${instrument}`.toUpperCase();
  if (/\bCALL\b|[-_]C$/.test(text)) return "call";
  if (/\bPUT\b|[-_]P$/.test(text)) return "put";
  return null;
}

function inferContractMultiplier(args: {
  underlying: "XAUT" | "GLD";
  netQty: number;
  markPrice: number | null;
  marketValue: number | null;
  entryPrice: number | null;
  entryValue: number | null;
}): number {
  const candidates = [
    args.markPrice && args.marketValue !== null ? Math.abs(args.marketValue / (args.markPrice * args.netQty)) : null,
    args.entryPrice && args.entryValue !== null ? Math.abs(args.entryValue / (args.entryPrice * args.netQty)) : null,
  ].filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  const inferred = candidates[0];
  if (inferred && Math.abs(inferred - 100) < 0.5) return 100;
  if (inferred && Math.abs(inferred - 1) < 0.05) return 1;
  return args.underlying === "GLD" ? 100 : 1;
}

function asTotal(row: ExcelJS.Row, column: (header: string) => number, underlying: "XAUT" | "GLD"): PositionExcelTotal {
  const value = (header: string) => numberOrNull(rawCellValue(row.getCell(column(header))));
  return {
    underlying,
    netQty: value("Net Qty"),
    xauEqNetQty: value("XAU Eq Net Qty"),
    entryCost: value("Entry Cost"),
    marketValue: value("Market Value"),
    totalDeltaXau: value("BS Delta XAU"),
    totalGammaXau: value("Gamma"),
    totalThetaUsdDay: value("Theta USD/day"),
    totalVegaUsdVol: value("Vega USD/vol"),
  };
}

export async function parsePositionWorkbook(buffer: Buffer, fileName: string): Promise<PositionExcelPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets.find(sheet => {
    const values = sheet.getRow(2).values as unknown[];
    const keys = new Set(values.map(keyOf));
    return keys.has(keyOf("Instrument")) && keys.has(keyOf("Underlying")) && keys.has(keyOf("Net Qty"));
  }) ?? workbook.worksheets[0];
  if (!worksheet) throw new Error("Excel 没有可读取的工作表");

  const warnings: string[] = [];
  const errors: string[] = [];
  const headers = Array.from({ length: worksheet.columnCount }, (_, index) => cleanText(rawCellValue(worksheet.getRow(2).getCell(index + 1))));
  const headerMap = new Map(headers.map((header, index) => [keyOf(header), index + 1]));
  const missingHeaders = POSITION_EXCEL_HEADERS.filter(header => !headerMap.has(keyOf(header)));
  if (missingHeaders.length) errors.push(`缺少列：${missingHeaders.join("、")}`);
  const column = (header: string) => headerMap.get(keyOf(header)) ?? -1;
  const positions: ImportedPosition[] = [];
  const totals: PositionExcelTotal[] = [];

  if (!errors.length) {
    for (let rowNumber = 3; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const instrument = cleanText(rawCellValue(row.getCell(column("Instrument"))));
      const explicitUnderlying = rawCellValue(row.getCell(column("Underlying")));
      if (!instrument && !cleanText(explicitUnderlying)) continue;
      const underlying = normalizeUnderlying(explicitUnderlying, instrument);
      if (!underlying) {
        errors.push(`第 ${rowNumber} 行：无法识别 Underlying（仅支持 GLD/XAUT）`);
        continue;
      }
      if (instrument.toLowerCase() === "total") {
        totals.push(asTotal(row, column, underlying));
        continue;
      }
      const optionType = normalizeCallPut(rawCellValue(row.getCell(column("Call/Put"))), instrument);
      const expiry = excelDate(rawCellValue(row.getCell(column("Expiry"))));
      const strike = numberOrNull(rawCellValue(row.getCell(column("Strike"))));
      const qtyLong = numberOrNull(rawCellValue(row.getCell(column("Qty Long")))) ?? 0;
      const qtyShort = numberOrNull(rawCellValue(row.getCell(column("Qty Short")))) ?? 0;
      const netFromColumns = qtyLong - qtyShort;
      const suppliedNet = numberOrNull(rawCellValue(row.getCell(column("Net Qty"))));
      const netQty = suppliedNet ?? netFromColumns;
      if (!optionType || !expiry || strike === null || strike <= 0 || !Number.isFinite(netQty) || netQty === 0) {
        errors.push(`第 ${rowNumber} 行 ${instrument || "(无 Instrument)"}：Expiry/Strike/Call-Put/Net Qty 不完整或无效`);
        continue;
      }
      if (suppliedNet !== null && Math.abs(suppliedNet - netFromColumns) > 1e-8) {
        warnings.push(`第 ${rowNumber} 行 ${instrument}：Net Qty ${suppliedNet} 与 Qty Long-Qty Short ${netFromColumns} 不一致，采用 Net Qty`);
      }
      const markPrice = numberOrNull(rawCellValue(row.getCell(column("Mark Price"))));
      const entryPrice = numberOrNull(rawCellValue(row.getCell(column("Avg/Entry Price"))));
      const marketValue = numberOrNull(rawCellValue(row.getCell(column("Market Value"))));
      const entryValue = numberOrNull(rawCellValue(row.getCell(column("Entry Value"))));
      const fee = numberOrNull(rawCellValue(row.getCell(column("Fee")))) ?? 0;
      const entryCost = numberOrNull(rawCellValue(row.getCell(column("Entry Cost"))));
      const multiplierXau = numberOrNull(rawCellValue(row.getCell(column("Multiplier XAU"))));
      const totalDelta = numberOrNull(rawCellValue(row.getCell(column("BS Delta XAU"))));
      const totalGamma = numberOrNull(rawCellValue(row.getCell(column("Gamma"))));
      const totalTheta = numberOrNull(rawCellValue(row.getCell(column("Theta USD/day"))));
      const totalVega = numberOrNull(rawCellValue(row.getCell(column("Vega USD/vol"))));
      const contractMultiplier = inferContractMultiplier({ underlying, netQty, markPrice, marketValue, entryPrice, entryValue });
      const deltaScale = netQty * contractMultiplier * (multiplierXau ?? (underlying === "XAUT" ? 1 : 0));
      const gammaScale = netQty * contractMultiplier * (multiplierXau ?? (underlying === "XAUT" ? 1 : 0)) ** 2;
      const unitScale = netQty * contractMultiplier;
      const unitDelta = totalDelta !== null && deltaScale !== 0 ? totalDelta / deltaScale : null;
      const unitGamma = totalGamma !== null && gammaScale !== 0 ? totalGamma / gammaScale : null;
      const unitTheta = totalTheta !== null && unitScale !== 0 ? totalTheta / unitScale : null;
      const unitVega = totalVega !== null && unitScale !== 0 ? totalVega / unitScale : null;
      const rowWarnings = [markPrice, entryPrice, multiplierXau, totalDelta, totalGamma, totalTheta, totalVega].filter(value => value === null).length;
      if (rowWarnings) warnings.push(`第 ${rowNumber} 行 ${instrument}：有 ${rowWarnings} 个行情/Greeks 字段缺失，将显示 WARN/MISSING`);
      const currencyText = cleanText(rawCellValue(row.getCell(column("Currency")))).toUpperCase();
      positions.push({
        underlying,
        expiry,
        strike: numericString(strike, 6)!,
        optionType,
        entryPrice: numericString(entryPrice ?? 0, 10)!,
        quantity: numericString(netQty, 10)!,
        fee: numericString(fee, 10)!,
        entryDelta: numericString(unitDelta ?? 0, 10)!,
        sourceAccount: cleanText(rawCellValue(row.getCell(column("Source Account")))) || null,
        venue: cleanText(rawCellValue(row.getCell(column("Venue")))) || null,
        instrument,
        product: cleanText(rawCellValue(row.getCell(column("Product")))) || null,
        currency: currencyText === "USDT" ? "USDT" : "USD",
        qtyLong: numericString(qtyLong),
        qtyShort: numericString(qtyShort),
        multiplierXau: numericString(multiplierXau),
        xauEqNetQty: numericString(numberOrNull(rawCellValue(row.getCell(column("XAU Eq Net Qty"))))),
        referenceDate: excelDate(rawCellValue(row.getCell(column("Reference Date")))),
        importedMarkPrice: numericString(markPrice),
        importedMarketValue: numericString(marketValue),
        entryValue: numericString(entryValue),
        importedEntryCost: numericString(entryCost),
        importedUnrealizedPnl: numericString(numberOrNull(rawCellValue(row.getCell(column("Unrealized PnL"))))),
        importedUnrealizedPnlPct: numericString(numberOrNull(rawCellValue(row.getCell(column("Unrealized PnL%"))))),
        importedTotalDeltaXau: numericString(totalDelta),
        importedTotalGammaXau: numericString(totalGamma),
        importedTotalThetaUsdDay: numericString(totalTheta),
        importedTotalVegaUsdVol: numericString(totalVega),
        unitGamma: numericString(unitGamma),
        unitTheta: numericString(unitTheta),
        unitVega: numericString(unitVega),
        contractMultiplier: numericString(contractMultiplier),
        rawMarginMode: cleanText(rawCellValue(row.getCell(column("Raw Margin Mode")))) || null,
        rawMarginType: cleanText(rawCellValue(row.getCell(column("Raw Margin Type")))) || null,
        importSource: fileName,
        importRow: rowNumber,
        dataStatus: rowWarnings ? "WARN" : "STALE",
      });
    }
  }

  for (const total of totals) {
    const detail = positions.filter(position => position.underlying === total.underlying);
    const sum = (key: keyof ImportedPosition) => detail.reduce((acc, position) => acc + (numberOrNull(position[key]) ?? 0), 0);
    const checks: Array<[string, number | null, number]> = [
      ["Net Qty", total.netQty, sum("quantity")],
      ["Entry Cost", total.entryCost, sum("importedEntryCost")],
      ["Market Value", total.marketValue, sum("importedMarketValue")],
      ["BS Delta XAU", total.totalDeltaXau, sum("importedTotalDeltaXau")],
    ];
    for (const [label, supplied, calculated] of checks) {
      if (supplied !== null && Math.abs(supplied - calculated) > Math.max(0.02, Math.abs(supplied) * 0.0002)) {
        warnings.push(`${total.underlying} Total ${label}=${supplied}，明细求和=${Number(calculated.toFixed(4))}`);
      }
    }
  }

  const referenceDates = positions.map(position => position.referenceDate).filter((value): value is string => Boolean(value));
  return {
    fileName,
    sheetName: worksheet.name,
    title: cleanText(rawCellValue(worksheet.getRow(1).getCell(1))),
    headerRow: 2,
    headers,
    exactHeaderMatch: POSITION_EXCEL_HEADERS.every((header, index) => keyOf(headers[index]) === keyOf(header)),
    positions,
    totals,
    warnings,
    errors,
    referenceDate: referenceDates.sort().at(-1) ?? null,
    summary: {
      detailRows: positions.length,
      totalRows: totals.length,
      xautRows: positions.filter(position => position.underlying === "XAUT").length,
      gldRows: positions.filter(position => position.underlying === "GLD").length,
      xautNetQty: positions.filter(position => position.underlying === "XAUT").reduce((sum, position) => sum + Number(position.quantity), 0),
      gldNetQty: positions.filter(position => position.underlying === "GLD").reduce((sum, position) => sum + Number(position.quantity), 0),
    },
  };
}

const numberValue = (value: unknown): number | null => numberOrNull(value);
const isoToDate = (value: string | null | undefined): Date | null => value ? new Date(`${value}T00:00:00Z`) : null;

export async function createPositionWorkbook(positions: PositionRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Gold Options Hedge";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("期权持仓_XAUT_GLD", { views: [{ state: "frozen", xSplit: 3, ySplit: 2 }] });
  sheet.properties.defaultRowHeight = 18;
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "期权持仓明细（XAUT + GLD，统一口径）";
  const latestDate = positions.map(position => position.referenceDate).filter(Boolean).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  sheet.getCell("C1").value = isoToDate(latestDate);
  sheet.getCell("C1").numFmt = "yyyy/mm/dd";
  sheet.getRow(2).values = [...POSITION_EXCEL_HEADERS];
  const ordered = [...positions].sort((a, b) =>
    (a.underlying === b.underlying ? 0 : a.underlying === "XAUT" ? -1 : 1)
    || a.expiry.localeCompare(b.expiry)
    || Number(a.strike) - Number(b.strike));
  const detailStart = 5;
  const value = (position: PositionRecord, key: keyof PositionRecord) => numberValue(position[key]);

  for (let index = 0; index < ordered.length; index += 1) {
    const position = ordered[index];
    const rowNumber = detailStart + index;
    const netQty = Number(position.quantity);
    const contractMultiplier = value(position, "contractMultiplier") ?? (position.underlying === "GLD" ? 100 : 1);
    const multiplierXau = value(position, "multiplierXau") ?? (position.underlying === "XAUT" ? 1 : null);
    const markPrice = value(position, "importedMarkPrice");
    const entryPrice = Number(position.entryPrice);
    const fee = Number(position.fee);
    const marketValue = markPrice === null ? null : markPrice * netQty * contractMultiplier;
    const entryValue = entryPrice * netQty * contractMultiplier;
    const entryCost = entryValue + fee;
    const upl = marketValue === null ? null : marketValue - entryCost;
    const xauEq = multiplierXau === null ? null : netQty * contractMultiplier * multiplierXau;
    const totalDelta = value(position, "importedTotalDeltaXau") ?? (multiplierXau === null ? null : Number(position.entryDelta) * netQty * contractMultiplier * multiplierXau);
    const totalGamma = value(position, "importedTotalGammaXau") ?? (multiplierXau === null || !position.unitGamma ? null : Number(position.unitGamma) * netQty * contractMultiplier * multiplierXau ** 2);
    const totalTheta = value(position, "importedTotalThetaUsdDay") ?? (!position.unitTheta ? null : Number(position.unitTheta) * netQty * contractMultiplier);
    const totalVega = value(position, "importedTotalVegaUsdVol") ?? (!position.unitVega ? null : Number(position.unitVega) * netQty * contractMultiplier);
    const raw = [
      position.sourceAccount ?? "LOCAL-HEDGE",
      position.venue ?? (position.underlying === "XAUT" ? "Bybit" : "KGI manual order"),
      position.instrument ?? `${position.underlying}-${position.expiry}-${position.strike}-${position.optionType === "call" ? "C" : "P"}`,
      position.underlying,
      position.product ?? `${position.underlying} Option`,
      isoToDate(position.expiry),
      Number(position.strike),
      position.optionType === "call" ? "Call" : "Put",
      position.currency ?? (position.underlying === "XAUT" ? "USDT" : "USD"),
      value(position, "qtyLong") ?? Math.max(netQty, 0),
      value(position, "qtyShort") ?? Math.max(-netQty, 0),
      netQty,
      multiplierXau,
      xauEq,
      isoToDate(position.referenceDate ?? null),
      markPrice,
      entryPrice,
      marketValue,
      entryValue,
      fee,
      entryCost,
      upl,
      upl !== null && entryCost !== 0 ? upl / entryCost : null,
      totalDelta,
      totalGamma,
      totalTheta,
      totalVega,
      position.rawMarginMode ?? null,
      position.rawMarginType ?? null,
    ];
    sheet.getRow(rowNumber).values = raw;
    sheet.getCell(`R${rowNumber}`).value = { formula: `P${rowNumber}*L${rowNumber}*${contractMultiplier}`, result: marketValue ?? undefined };
    sheet.getCell(`S${rowNumber}`).value = { formula: `Q${rowNumber}*L${rowNumber}*${contractMultiplier}`, result: entryValue };
    sheet.getCell(`U${rowNumber}`).value = { formula: `S${rowNumber}+T${rowNumber}`, result: entryCost };
    sheet.getCell(`V${rowNumber}`).value = { formula: `R${rowNumber}-U${rowNumber}`, result: upl ?? undefined };
    sheet.getCell(`W${rowNumber}`).value = { formula: `IFERROR(V${rowNumber}/U${rowNumber},0)`, result: upl !== null && entryCost !== 0 ? upl / entryCost : 0 };
  }

  for (const [offset, underlying] of (["XAUT", "GLD"] as const).entries()) {
    const rowNumber = 3 + offset;
    const detail = ordered.filter(position => position.underlying === underlying);
    const sum = (key: keyof PositionRecord) => detail.reduce((total, position) => total + (numberValue(position[key]) ?? 0), 0);
    const netQty = detail.reduce((total, position) => total + Number(position.quantity), 0);
    const qtyLong = detail.reduce((total, position) => total + (numberValue(position.qtyLong) ?? Math.max(Number(position.quantity), 0)), 0);
    const qtyShort = detail.reduce((total, position) => total + (numberValue(position.qtyShort) ?? Math.max(-Number(position.quantity), 0)), 0);
    const multiplierXau = detail.map(position => numberValue(position.multiplierXau)).find(item => item !== null) ?? (underlying === "XAUT" ? 1 : null);
    const row = sheet.getRow(rowNumber);
    row.values = [
      detail[0]?.sourceAccount ?? (underlying === "XAUT" ? "SPTT-Dino-Bybit1" : "KGI-Dinobot-GLD1"),
      detail[0]?.venue ?? (underlying === "XAUT" ? "Bybit via SignalPlus Trading Terminal" : "KGI manual order"),
      "Total",
      underlying,
      `${underlying} Option`,
      null,
      null,
      null,
      underlying === "XAUT" ? "USDT" : "USD",
      qtyLong,
      qtyShort,
      netQty,
      multiplierXau,
      sum("xauEqNetQty"),
      isoToDate(latestDate),
      null,
      null,
      sum("importedMarketValue"),
      sum("entryValue"),
      sum("fee"),
      sum("importedEntryCost") || detail.reduce((total, position) => total + Number(position.entryPrice) * Number(position.quantity) * (numberValue(position.contractMultiplier) ?? (underlying === "GLD" ? 100 : 1)) + Number(position.fee), 0),
      sum("importedUnrealizedPnl"),
      null,
      sum("importedTotalDeltaXau"),
      sum("importedTotalGammaXau"),
      sum("importedTotalThetaUsdDay"),
      sum("importedTotalVegaUsdVol"),
      detail[0]?.rawMarginMode ?? null,
      detail[0]?.rawMarginType ?? null,
    ];
    const end = detailStart + ordered.length - 1;
    const criteria = `D${detailStart}:D${Math.max(detailStart, end)}`;
    for (const columnName of ["J", "K", "L", "N", "R", "S", "T", "U", "V", "X", "Y", "Z", "AA"]) {
      const current = row.getCell(columnName);
      const result = numberOrNull(rawCellValue(current)) ?? 0;
      current.value = { formula: `SUMIF(${criteria},D${rowNumber},${columnName}${detailStart}:${columnName}${Math.max(detailStart, end)})`, result };
    }
    const totalEntryCost = numberOrNull(rawCellValue(sheet.getCell(`U${rowNumber}`))) ?? 0;
    const totalUpl = numberOrNull(rawCellValue(sheet.getCell(`V${rowNumber}`))) ?? 0;
    sheet.getCell(`W${rowNumber}`).value = {
      formula: `IFERROR(V${rowNumber}/U${rowNumber},0)`,
      result: totalEntryCost === 0 ? 0 : totalUpl / totalEntryCost,
    };
  }

  sheet.autoFilter = { from: "A2", to: `AC${Math.max(4, detailStart + ordered.length - 1)}` };
  const titleStyle: Partial<ExcelJS.Style> = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F33" } }, font: { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 11 }, alignment: { horizontal: "center", vertical: "middle" } };
  sheet.getCell("A1").style = titleStyle;
  sheet.getRow(2).eachCell(cell => { cell.style = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }, font: { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 }, alignment: { vertical: "middle", wrapText: true }, border: { bottom: { style: "thin", color: { argb: "FFD9E2F3" } } } }; });
  for (const rowNumber of [3, 4]) sheet.getRow(rowNumber).eachCell(cell => { cell.style = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } }, font: { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 }, alignment: { vertical: "middle" } }; });
  for (let rowNumber = detailStart; rowNumber < detailStart + ordered.length; rowNumber += 1) {
    sheet.getRow(rowNumber).eachCell((cell, columnNumber) => {
      const fill = columnNumber >= 6 && columnNumber <= 17 ? "FFDDEBF7" : columnNumber >= 24 && columnNumber <= 27 ? "FFE2F0D9" : rowNumber % 2 ? "FFF4F7FB" : "FFFFFFFF";
      cell.style = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: fill } }, font: { name: "Arial", size: 9, color: { argb: "FF1F2937" } }, alignment: { vertical: "middle", wrapText: columnNumber === 3 }, border: { bottom: { style: "hair", color: { argb: "FFD9E2F3" } } } };
    });
  }
  sheet.getColumn(6).numFmt = "yyyy/mm/dd";
  sheet.getColumn(15).numFmt = "yyyy/mm/dd";
  for (const columnNumber of [7, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27]) sheet.getColumn(columnNumber).numFmt = "#,##0.0000;[Red](#,##0.0000);-";
  sheet.getColumn(23).numFmt = "0.00%;[Red](0.00%);-";
  const widths = [20, 34, 39, 12, 16, 13, 11, 11, 10, 10, 10, 10, 14, 15, 15, 12, 15, 15, 14, 10, 13, 16, 16, 15, 12, 16, 16, 20, 16];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getRow(1).height = 22;
  sheet.getRow(2).height = 34;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
