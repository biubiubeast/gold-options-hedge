import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { formatReferenceSnapshotTime, POSITION_EXCEL_HEADERS, POSITION_EXCEL_REQUIRED_HEADERS } from "../shared/positionExcel";
import { createPositionWorkbook, parsePositionWorkbook } from "./positionExcel";
import type { PositionRecord } from "./db";
import { DEFAULT_FORMULAS } from "../shared/marketTypes";

async function fixtureWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("期权持仓_XAUT_GLD");
  sheet.getCell("A1").value = "期权持仓明细（XAUT + GLD，统一口径）";
  sheet.getCell("C1").value = new Date("2026-08-07T00:00:00.000Z");
  sheet.getRow(2).values = [...POSITION_EXCEL_REQUIRED_HEADERS];
  sheet.getRow(3).values = ["ACC-X", "Bybit", "Total", "XAUT", "XAUT Option", null, null, null, "USDT", 10, 0, 10, 1, 10, new Date("2026-08-07"), null, null, 600, 100, 2, 102, 498, 4.8823529412, 5, 0.02, -12, 20, "cross", "portfolio"];
  sheet.getRow(4).values = ["ACC-G", "KGI", "Total", "GLD", "GLD Option", null, null, null, "USD", 2, 0, 2, 0.092, 18.4, new Date("2026-08-07"), null, null, 1400, 1000, 5, 1005, 395, 0.3930348259, 9.2, 0.08, -50, 80, null, null];
  sheet.getRow(5).values = ["ACC-X", "Bybit", "XAUT-20260828-3400-C", "XAUT", "XAUT Option", new Date("2026-08-28"), 3400, "Call", "USDT", 10, 0, 10, 1, 10, new Date("2026-08-07"), 60, 10, 600, 100, 2, 102, 498, 4.8823529412, 5, 0.02, -12, 20, "cross", "portfolio"];
  sheet.getRow(6).values = ["ACC-G", "KGI", "GLD  260828C00250000", "GLD", "GLD Option", new Date("2026-08-28"), 250, "Call", "USD", 2, 0, 2, 0.092, 18.4, new Date("2026-08-07"), 7, 5, 1400, 1000, 5, 1005, 395, 0.3930348259, 9.2, 0.08, -50, 80, null, null];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("position Excel import/export", () => {
  it("shows the Excel reference date together with the actual HKT import time", () => {
    expect(formatReferenceSnapshotTime("2026-08-16", "2026-08-17T11:15:12.000Z"))
      .toBe("2026-08-16 · Imported 2026-08-17 19:15:12 HKT");
    expect(formatReferenceSnapshotTime(null, "2026-08-17T11:15:12.000Z")).toBe("—");
  });

  it("reads the legacy 29-column layout and derives unit Greeks without importing Total rows", async () => {
    const preview = await parsePositionWorkbook(await fixtureWorkbook(), "0810DinoSignal持仓.xlsx");
    expect(preview.exactHeaderMatch).toBe(true);
    expect(preview.extendedHeaderMatch).toBe(false);
    expect(preview.errors).toEqual([]);
    expect(preview.summary).toMatchObject({ detailRows: 2, totalRows: 2, xautRows: 1, gldRows: 1, xautNetQty: 10, gldNetQty: 2 });
    const gld = preview.positions.find(position => position.underlying === "GLD")!;
    expect(gld.contractMultiplier).toBe("100");
    expect(Number(gld.entryDelta)).toBeCloseTo(0.5, 10);
    expect(Number(gld.unitGamma)).toBeCloseTo(0.08 / (2 * 100 * 0.092 ** 2), 10);
    expect(Number(gld.unitTheta)).toBeCloseTo(-0.25, 10);
    expect(Number(gld.unitVega)).toBeCloseTo(0.4, 10);
  });

  it("uses standard GLD 100 shares per contract even when a legacy workbook stores per-share values", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await fixtureWorkbook() as any);
    const sheet = workbook.getWorksheet("期权持仓_XAUT_GLD")!;
    sheet.getCell("R6").value = 14;
    sheet.getCell("S6").value = 10;
    const preview = await parsePositionWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "legacy-per-share-values.xlsx");
    const gld = preview.positions.find(position => position.underlying === "GLD")!;
    expect(gld.contractMultiplier).toBe("100");
    expect(Number(gld.entryDelta)).toBeCloseTo(0.5, 10);
  });

  it("reads optional Shares/Contract and Unit Greek columns when supplied", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await fixtureWorkbook() as any);
    const sheet = workbook.getWorksheet("期权持仓_XAUT_GLD")!;
    sheet.getRow(2).values = [...POSITION_EXCEL_HEADERS];
    [50, 0.123, 0.004, -0.75, 1.25].forEach((value, index) => { sheet.getCell(6, 30 + index).value = value; });
    const preview = await parsePositionWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "extended.xlsx");
    const gld = preview.positions.find(position => position.underlying === "GLD")!;
    expect(preview.extendedHeaderMatch).toBe(true);
    expect(gld.contractMultiplier).toBe("50");
    expect(gld.entryDelta).toBe("0.123");
    expect(gld.unitGamma).toBe("0.004");
    expect(gld.unitTheta).toBe("-0.75");
    expect(gld.unitVega).toBe("1.25");
  });

  it("fills the required GLD/XAUT source-account and venue defaults when cells are blank", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await fixtureWorkbook() as any);
    const sheet = workbook.getWorksheet("期权持仓_XAUT_GLD")!;
    for (const rowNumber of [5, 6]) {
      sheet.getCell(`A${rowNumber}`).value = null;
      sheet.getCell(`B${rowNumber}`).value = null;
    }
    const preview = await parsePositionWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "blank-source.xlsx");
    const xaut = preview.positions.find(position => position.underlying === "XAUT")!;
    const gld = preview.positions.find(position => position.underlying === "GLD")!;
    expect(xaut).toMatchObject({ sourceAccount: "SPTT-Dino-Bybit1", venue: "Bybit via SignalPlus Trading Terminal" });
    expect(gld).toMatchObject({ sourceAccount: "KGI-Dinobot-GLD1", venue: "KGI manual order" });
  });

  it("exports a workbook that round-trips through the same template", async () => {
    const preview = await parsePositionWorkbook(await fixtureWorkbook(), "source.xlsx");
    const now = new Date("2026-08-11T00:00:00.000Z");
    const records: PositionRecord[] = preview.positions.map((position, index) => ({
      ...position,
      product: "Legacy Wrong Product",
      cumulativeEntryCost: position.underlying === "GLD" ? "1200" : "150",
      cumulativeRealizedPnl: position.underlying === "GLD" ? "300" : "-20",
      id: index + 1,
      userId: 1,
      createdAt: now,
      updatedAt: now,
    }));
    const exported = await createPositionWorkbook(records, DEFAULT_FORMULAS, [{
      underlying: "GLD", source: "KGI", sheetName: "Sheet1", sourceAccount: "ACC-G", venue: "KGI", currency: "USD", referenceDate: "2026-08-07",
      tradeRows: 8, ignoredRows: 0, duplicateRows: 0, openPositions: 1, netQty: 2, currentEntryCost: 1005, cumulativeEntryCost: 2500, cumulativeRealizedPnl: 700,
    }]);
    const exportedWorkbook = new ExcelJS.Workbook();
    await exportedWorkbook.xlsx.load(exported as any);
    expect(exportedWorkbook.worksheets.map(sheet => sheet.name)).toEqual(["期权持仓_XAUT_GLD", "Market_Data_实时明细"]);
    expect(exportedWorkbook.getWorksheet("Market_Data_实时明细")?.getRow(1).values).toContain("Mark IV");
    const detailSheet = exportedWorkbook.getWorksheet("期权持仓_XAUT_GLD")!;
    expect(detailSheet.getRow(2).values).toEqual([undefined, ...POSITION_EXCEL_HEADERS]);
    expect(detailSheet.getCell("AD5").value).toBe(1);
    expect(detailSheet.getCell("AD6").value).toBe(100);
    expect(detailSheet.getCell("AE6").value).toBeCloseTo(0.5, 10);
    expect(detailSheet.getCell("E5").value).toBe("XAUT Option");
    expect(detailSheet.getCell("E6").value).toBe("GLD Option");
    expect(detailSheet.getCell("AI6").value).toBe(1200);
    expect(detailSheet.getCell("AJ6").value).toBe(300);
    expect(detailSheet.getCell("AI4").value).toBe(2500);
    expect(detailSheet.getCell("AJ4").value).toBe(700);
    const roundTrip = await parsePositionWorkbook(exported, "exported.xlsx");
    expect(roundTrip.exactHeaderMatch).toBe(true);
    expect(roundTrip.extendedHeaderMatch).toBe(true);
    expect(roundTrip.errors).toEqual([]);
    expect(roundTrip.summary.detailRows).toBe(2);
    expect(roundTrip.totals.find(total => total.underlying === "GLD")?.netQty).toBe(2);
    expect(roundTrip.positions.find(position => position.underlying === "XAUT")?.instrument).toBe("XAUT-20260828-3400-C");
    expect(roundTrip.positions.find(position => position.underlying === "GLD")?.cumulativeRealizedPnl).toBe("300");
  });

  it("exports current editable GLD/XAUT contract multipliers and recalculated Greeks", async () => {
    const preview = await parsePositionWorkbook(await fixtureWorkbook(), "source.xlsx");
    const now = new Date("2026-08-11T00:00:00.000Z");
    const records: PositionRecord[] = preview.positions.map((position, index) => ({ ...position, id: index + 1, userId: 1, createdAt: now, updatedAt: now }));
    const overrides: Record<string, string> = { gld_contract_multiplier: "200", xaut_contract_multiplier: "2" };
    const formulas = DEFAULT_FORMULAS.map(formula => overrides[formula.name] ? { ...formula, expression: overrides[formula.name] } : formula);
    const exported = await createPositionWorkbook(records, formulas);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported as any);
    const sheet = workbook.getWorksheet("期权持仓_XAUT_GLD")!;
    const result = (address: string) => {
      const value = sheet.getCell(address).value as any;
      return Number(value && typeof value === "object" && "result" in value ? value.result : value);
    };
    expect(result("R5")).toBe(1200);
    expect(result("X5")).toBe(10);
    expect(result("R6")).toBe(2800);
    expect(result("X6")).toBeCloseTo(18.4, 10);
    expect(result("Y6")).toBeCloseTo(0.16, 10);
    expect(result("AD5")).toBe(2);
    expect(result("AD6")).toBe(200);
    expect(sheet.getCell("A5").value).toBe("ACC-X");
    expect(sheet.getCell("B6").value).toBe("KGI");
  });
});
