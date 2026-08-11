import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { POSITION_EXCEL_HEADERS } from "../shared/positionExcel";
import { createPositionWorkbook, parsePositionWorkbook } from "./positionExcel";
import type { PositionRecord } from "./db";

async function fixtureWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("期权持仓_XAUT_GLD");
  sheet.getCell("A1").value = "期权持仓明细（XAUT + GLD，统一口径）";
  sheet.getCell("C1").value = new Date("2026-08-07T00:00:00.000Z");
  sheet.getRow(2).values = [...POSITION_EXCEL_HEADERS];
  sheet.getRow(3).values = ["ACC-X", "Bybit", "Total", "XAUT", "XAUT Option", null, null, null, "USDT", 10, 0, 10, 1, 10, new Date("2026-08-07"), null, null, 600, 100, 2, 102, 498, 4.8823529412, 5, 0.02, -12, 20, "cross", "portfolio"];
  sheet.getRow(4).values = ["ACC-G", "KGI", "Total", "GLD", "GLD Option", null, null, null, "USD", 2, 0, 2, 0.092, 18.4, new Date("2026-08-07"), null, null, 1400, 1000, 5, 1005, 395, 0.3930348259, 9.2, 0.08, -50, 80, null, null];
  sheet.getRow(5).values = ["ACC-X", "Bybit", "XAUT-20260828-3400-C", "XAUT", "XAUT Option", new Date("2026-08-28"), 3400, "Call", "USDT", 10, 0, 10, 1, 10, new Date("2026-08-07"), 60, 10, 600, 100, 2, 102, 498, 4.8823529412, 5, 0.02, -12, 20, "cross", "portfolio"];
  sheet.getRow(6).values = ["ACC-G", "KGI", "GLD  260828C00250000", "GLD", "GLD Option", new Date("2026-08-28"), 250, "Call", "USD", 2, 0, 2, 0.092, 18.4, new Date("2026-08-07"), 7, 5, 1400, 1000, 5, 1005, 395, 0.3930348259, 9.2, 0.08, -50, 80, null, null];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("position Excel import/export", () => {
  it("reads the exact 29-column layout and derives unit Greeks without importing Total rows", async () => {
    const preview = await parsePositionWorkbook(await fixtureWorkbook(), "0810DinoSignal持仓.xlsx");
    expect(preview.exactHeaderMatch).toBe(true);
    expect(preview.errors).toEqual([]);
    expect(preview.summary).toMatchObject({ detailRows: 2, totalRows: 2, xautRows: 1, gldRows: 1, xautNetQty: 10, gldNetQty: 2 });
    const gld = preview.positions.find(position => position.underlying === "GLD")!;
    expect(gld.contractMultiplier).toBe("100");
    expect(Number(gld.entryDelta)).toBeCloseTo(0.5, 10);
    expect(Number(gld.unitGamma)).toBeCloseTo(0.08 / (2 * 100 * 0.092 ** 2), 10);
    expect(Number(gld.unitTheta)).toBeCloseTo(-0.25, 10);
    expect(Number(gld.unitVega)).toBeCloseTo(0.4, 10);
  });

  it("exports a workbook that round-trips through the same template", async () => {
    const preview = await parsePositionWorkbook(await fixtureWorkbook(), "source.xlsx");
    const now = new Date("2026-08-11T00:00:00.000Z");
    const records: PositionRecord[] = preview.positions.map((position, index) => ({ ...position, id: index + 1, userId: 1, createdAt: now, updatedAt: now }));
    const exported = await createPositionWorkbook(records);
    const roundTrip = await parsePositionWorkbook(exported, "exported.xlsx");
    expect(roundTrip.exactHeaderMatch).toBe(true);
    expect(roundTrip.errors).toEqual([]);
    expect(roundTrip.summary.detailRows).toBe(2);
    expect(roundTrip.totals.find(total => total.underlying === "GLD")?.netQty).toBe(2);
    expect(roundTrip.positions.find(position => position.underlying === "XAUT")?.instrument).toBe("XAUT-20260828-3400-C");
  });
});
