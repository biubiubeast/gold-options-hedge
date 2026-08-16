import ExcelJS from "exceljs";
import {
  POSITION_EXCEL_HEADERS,
  POSITION_SOURCE_DEFAULTS,
  type ImportedPosition,
  type PositionExcelPreview,
  type PositionExcelTotal,
} from "@shared/positionExcel";
import type { PositionRecord } from "./db";
import {
  DEFAULT_GLD_CONTRACT_MULTIPLIER,
  DEFAULT_XAUT_CONTRACT_MULTIPLIER,
  evaluateNamedFormula,
  resolveGldContractMultiplier,
  resolveGldXauMultiplier,
  resolveXautContractMultiplier,
  resolveXautXauMultiplier,
} from "@shared/formulaEngine";
import { DEFAULT_FORMULAS, type FormulaLike } from "@shared/marketTypes";

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

function normalizeUnderlying(value: unknown, instrument: string): "XAUT" | "GLD" | "BTC" | null {
  const text = `${cleanText(value)} ${instrument}`.toUpperCase();
  if (text.includes("XAUT")) return "XAUT";
  if (text.includes("GLD") || text.includes("SPDR GOLD SHARES")) return "GLD";
  if (/\bBTC\b|BITCOIN/.test(text)) return "BTC";
  return null;
}

function normalizeCallPut(value: unknown, instrument: string): "call" | "put" | null {
  const text = `${cleanText(value)} ${instrument}`.toUpperCase();
  if (/\bCALL\b|[-_]C$/.test(text)) return "call";
  if (/\bPUT\b|[-_]P$/.test(text)) return "put";
  return null;
}

function inferContractMultiplier(args: {
  underlying: "XAUT" | "GLD" | "BTC";
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
  if (inferred) return Number(inferred.toFixed(10));
  return args.underlying === "GLD" ? 100 : 1;
}

function asTotal(row: ExcelJS.Row, column: (header: string) => number, underlying: "XAUT" | "GLD" | "BTC"): PositionExcelTotal {
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
        errors.push(`第 ${rowNumber} 行：无法识别 Underlying（支持 GLD/XAUT/BTC）`);
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
      const sourceDefaults = POSITION_SOURCE_DEFAULTS[underlying];
      positions.push({
        underlying,
        expiry,
        strike: numericString(strike, 6)!,
        optionType,
        entryPrice: numericString(entryPrice ?? 0, 10)!,
        quantity: numericString(netQty, 10)!,
        fee: numericString(fee, 10)!,
        entryDelta: numericString(unitDelta ?? 0, 10)!,
        sourceAccount: cleanText(rawCellValue(row.getCell(column("Source Account")))) || sourceDefaults.sourceAccount,
        venue: cleanText(rawCellValue(row.getCell(column("Venue")))) || sourceDefaults.venue,
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
      btcRows: positions.filter(position => position.underlying === "BTC").length,
      xautNetQty: positions.filter(position => position.underlying === "XAUT").reduce((sum, position) => sum + Number(position.quantity), 0),
      gldNetQty: positions.filter(position => position.underlying === "GLD").reduce((sum, position) => sum + Number(position.quantity), 0),
      btcNetQty: positions.filter(position => position.underlying === "BTC").reduce((sum, position) => sum + Number(position.quantity), 0),
    },
  };
}

const numberValue = (value: unknown): number | null => numberOrNull(value);
const isoToDate = (value: string | null | undefined): Date | null => value ? new Date(`${value}T00:00:00Z`) : null;

function formulaValue(name: string, variables: Record<string, number>, formulas: readonly FormulaLike[], fallback: number) {
  try {
    const result = evaluateNamedFormula(name, variables, formulas, new Set());
    return Number.isFinite(result) ? result : fallback;
  } catch {
    return fallback;
  }
}

function exportPositionValues(position: PositionRecord, formulas: readonly FormulaLike[]) {
  const rawContractMultiplier = numberValue(position.contractMultiplier);
  const nonStandardGld = position.underlying === "GLD" && rawContractMultiplier !== null
    && Math.abs(rawContractMultiplier - DEFAULT_GLD_CONTRACT_MULTIPLIER) > 1e-9;
  const nonStandardXaut = position.underlying === "XAUT" && rawContractMultiplier !== null
    && Math.abs(rawContractMultiplier - DEFAULT_XAUT_CONTRACT_MULTIPLIER) > 1e-9;
  const contractMultiplier = position.underlying === "GLD"
    ? nonStandardGld ? rawContractMultiplier! : resolveGldContractMultiplier(formulas)
    : position.underlying === "XAUT"
      ? nonStandardXaut ? rawContractMultiplier! : resolveXautContractMultiplier(formulas)
      : rawContractMultiplier ?? 1;
  const rawMultiplierXau = numberValue(position.multiplierXau);
  const multiplierXau = position.underlying === "GLD"
    ? nonStandardGld && rawMultiplierXau !== null ? rawMultiplierXau : resolveGldXauMultiplier(formulas)
    : position.underlying === "XAUT"
      ? nonStandardXaut && rawMultiplierXau !== null ? rawMultiplierXau : resolveXautXauMultiplier(formulas)
      : rawMultiplierXau;
  const quantity = Number(position.quantity);
  const entryPrice = Number(position.entryPrice);
  const fee = Number(position.fee);
  const markPrice = numberValue(position.importedMarkPrice);
  const delta = numberValue(position.entryDelta);
  const gamma = numberValue(position.unitGamma);
  const theta = numberValue(position.unitTheta);
  const vega = numberValue(position.unitVega);
  const baseVariables = {
    entryPrice, quantity, fee, markPrice: markPrice ?? 0, contractMultiplier,
    delta: delta ?? 0, gamma: gamma ?? 0, theta: theta ?? 0, vega: vega ?? 0,
    spotScale: multiplierXau ?? 0, underlyingPrice: 0, xauUsdPrice: 0,
  };
  const entryValue = entryPrice * quantity * contractMultiplier;
  const entryCost = formulaValue("entry_cost", baseVariables, formulas, entryValue + fee);
  const marketValue = markPrice === null ? null : formulaValue("current_value", baseVariables, formulas, markPrice * quantity * contractMultiplier);
  const upl = marketValue === null ? null : formulaValue("pnl", { ...baseVariables, currentValue: marketValue, entryCost }, formulas, marketValue - entryCost);
  const totalDelta = multiplierXau === null || delta === null ? null : formulaValue("total_delta_xau", baseVariables, formulas, delta * quantity * contractMultiplier * multiplierXau);
  const totalGamma = multiplierXau === null || gamma === null ? null : formulaValue("total_gamma_xau", baseVariables, formulas, gamma * quantity * contractMultiplier * multiplierXau ** 2);
  const totalTheta = theta === null ? null : formulaValue("total_theta", baseVariables, formulas, theta * quantity * contractMultiplier);
  const totalVega = vega === null ? null : formulaValue("total_vega", baseVariables, formulas, vega * quantity * contractMultiplier);
  const xauEq = multiplierXau === null ? null : quantity * contractMultiplier * multiplierXau;
  return { contractMultiplier, multiplierXau, xauEq, entryValue, entryCost, marketValue, upl, totalDelta, totalGamma, totalTheta, totalVega };
}

export async function createPositionWorkbook(positions: PositionRecord[], customFormulas: readonly FormulaLike[] = DEFAULT_FORMULAS): Promise<Buffer> {
  const formulas = customFormulas.length ? customFormulas : DEFAULT_FORMULAS;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Gold Options Hedge";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("期权持仓_XAUT_GLD", { views: [{ state: "frozen", xSplit: 3, ySplit: 2 }] });
  sheet.properties.defaultRowHeight = 18;
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "期权持仓明细（XAUT + GLD + BTC，统一口径）";
  const latestMarketDate = positions.map(position => position.marketQuoteTime?.slice(0, 10)).filter(Boolean).sort().at(-1);
  const latestDate = latestMarketDate ?? positions.map(position => position.referenceDate).filter(Boolean).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  sheet.getCell("C1").value = isoToDate(latestDate);
  sheet.getCell("C1").numFmt = "yyyy/mm/dd";
  sheet.getRow(2).values = [...POSITION_EXCEL_HEADERS];
  const ordered = [...positions].sort((a, b) =>
    (["XAUT", "GLD", "BTC"].indexOf(a.underlying) - ["XAUT", "GLD", "BTC"].indexOf(b.underlying))
    || a.expiry.localeCompare(b.expiry)
    || Number(a.strike) - Number(b.strike));
  const totalUnderlyings = positions.some(position => position.underlying === "BTC")
    ? (["XAUT", "GLD", "BTC"] as const)
    : (["XAUT", "GLD"] as const);
  const detailStart = 3 + totalUnderlyings.length;
  const value = (position: PositionRecord, key: keyof PositionRecord) => numberValue(position[key]);
  const calculated = new Map(ordered.map(position => [position.id, exportPositionValues(position, formulas)]));

  for (let index = 0; index < ordered.length; index += 1) {
    const position = ordered[index];
    const rowNumber = detailStart + index;
    const netQty = Number(position.quantity);
    const formulaValues = calculated.get(position.id)!;
    const contractMultiplier = formulaValues.contractMultiplier;
    const multiplierXau = formulaValues.multiplierXau;
    const markPrice = value(position, "importedMarkPrice");
    const entryPrice = Number(position.entryPrice);
    const fee = Number(position.fee);
    const { marketValue, entryValue, entryCost, upl, xauEq, totalDelta, totalGamma, totalTheta, totalVega } = formulaValues;
    const raw = [
      position.sourceAccount ?? POSITION_SOURCE_DEFAULTS[position.underlying].sourceAccount,
      position.venue ?? POSITION_SOURCE_DEFAULTS[position.underlying].venue,
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
      isoToDate(position.marketQuoteTime?.slice(0, 10) ?? position.referenceDate ?? null),
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

  for (const [offset, underlying] of totalUnderlyings.entries()) {
    const rowNumber = 3 + offset;
    const detail = ordered.filter(position => position.underlying === underlying);
    const sum = (key: keyof PositionRecord) => detail.reduce((total, position) => total + (numberValue(position[key]) ?? 0), 0);
    const calculatedSum = (key: keyof ReturnType<typeof exportPositionValues>) => detail.reduce((total, position) => total + (numberValue(calculated.get(position.id)?.[key]) ?? 0), 0);
    const netQty = detail.reduce((total, position) => total + Number(position.quantity), 0);
    const qtyLong = detail.reduce((total, position) => total + (numberValue(position.qtyLong) ?? Math.max(Number(position.quantity), 0)), 0);
    const qtyShort = detail.reduce((total, position) => total + (numberValue(position.qtyShort) ?? Math.max(-Number(position.quantity), 0)), 0);
    const multiplierXau = detail.map(position => calculated.get(position.id)?.multiplierXau ?? null).find(item => item !== null) ?? null;
    const row = sheet.getRow(rowNumber);
    row.values = [
      detail[0]?.sourceAccount ?? POSITION_SOURCE_DEFAULTS[underlying].sourceAccount,
      detail[0]?.venue ?? POSITION_SOURCE_DEFAULTS[underlying].venue,
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
      calculatedSum("xauEq"),
      isoToDate(latestDate),
      null,
      null,
      calculatedSum("marketValue"),
      calculatedSum("entryValue"),
      sum("fee"),
      calculatedSum("entryCost"),
      calculatedSum("upl"),
      null,
      calculatedSum("totalDelta"),
      calculatedSum("totalGamma"),
      calculatedSum("totalTheta"),
      calculatedSum("totalVega"),
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
  for (let rowNumber = 3; rowNumber < detailStart; rowNumber += 1) sheet.getRow(rowNumber).eachCell(cell => { cell.style = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } }, font: { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 }, alignment: { vertical: "middle" } }; });
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

  const audit = workbook.addWorksheet("Market_Data_实时明细", { views: [{ state: "frozen", ySplit: 1 }] });
  audit.columns = [
    ["Instrument", 38], ["Underlying", 12], ["Expiry", 13], ["Strike", 11], ["Call/Put", 10],
    ["Mark Price", 13], ["Mark IV", 12], ["Bid1", 12], ["Ask1", 12], ["Unit Delta", 13],
    ["Unit Gamma", 13], ["Unit Theta", 13], ["Unit Vega", 13], ["Open Interest", 14], ["Volume", 12],
    ["Total Delta XAU", 17], ["Total Gamma XAU", 17], ["Theta USD/day", 16], ["Vega USD/vol", 16],
    ["Market Value", 15], ["UPL", 15], ["Source", 30], ["Quote As-of", 23], ["Refresh At", 23], ["Status", 11],
  ].map(([header, width]) => ({ header: String(header), key: String(header), width: Number(width) }));
  for (const position of ordered) {
    const formulaValues = calculated.get(position.id)!;
    audit.addRow({
    Instrument: position.instrument ?? `${position.underlying}-${position.expiry}-${position.strike}-${position.optionType}`,
    Underlying: position.underlying, Expiry: isoToDate(position.expiry), Strike: Number(position.strike), "Call/Put": position.optionType === "call" ? "Call" : "Put",
    "Mark Price": value(position, "importedMarkPrice"), "Mark IV": value(position, "markIv"), Bid1: value(position, "bid1Price"), Ask1: value(position, "ask1Price"),
    "Unit Delta": Number(position.entryDelta), "Unit Gamma": value(position, "unitGamma"), "Unit Theta": value(position, "unitTheta"), "Unit Vega": value(position, "unitVega"),
    "Open Interest": value(position, "openInterest"), Volume: value(position, "optionVolume"), "Total Delta XAU": formulaValues.totalDelta,
    "Total Gamma XAU": formulaValues.totalGamma, "Theta USD/day": formulaValues.totalTheta, "Vega USD/vol": formulaValues.totalVega,
    "Market Value": formulaValues.marketValue, UPL: formulaValues.upl, Source: position.marketSource ?? position.importSource ?? "MISSING",
    "Quote As-of": position.marketQuoteTime ? new Date(position.marketQuoteTime) : null, "Refresh At": position.lastMarketRefreshAt ? new Date(position.lastMarketRefreshAt) : null,
    Status: position.dataStatus ?? "MISSING",
    });
  }
  audit.getRow(1).eachCell(cell => { cell.style = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F33" } }, font: { bold: true, color: { argb: "FFFFFFFF" } }, alignment: { vertical: "middle", wrapText: true } }; });
  audit.autoFilter = { from: "A1", to: `Y${Math.max(1, audit.rowCount)}` };
  for (const columnNumber of [6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21]) audit.getColumn(columnNumber).numFmt = "#,##0.0000;[Red](#,##0.0000);-";
  audit.getColumn(4).numFmt = "#,##0.000";
  audit.getColumn(7).numFmt = "0.00%";
  audit.getColumn(3).numFmt = "yyyy/mm/dd";
  audit.getColumn(23).numFmt = "yyyy/mm/dd hh:mm:ss";
  audit.getColumn(24).numFmt = "yyyy/mm/dd hh:mm:ss";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
