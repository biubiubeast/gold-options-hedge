import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseTransactionWorkbook } from "./transactionExcel";

const headers = [
  "Date(UTC)", "Exchange", "Uid Name", "Uid", "Account", "Instrument", "Type", "Side", "Qty", "QtyCcy", "Price", "PriceCcy",
  "MarkPrice", "MarkPriceCcy", "Fee", "FeeCcy", "Funding", "FundingCcy", "Change", "ChangeCcy", "Balance", "BalanceCcy", "TradeId", "OrderId", "BillId", "Info",
];

async function workbookBuffer(rows: unknown[][], sheetName = "Sheet1") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const row = (args: {
  date: string;
  exchange: "KGI" | "BYBIT";
  instrument: string;
  type: string;
  side: "BUY" | "SELL";
  qty: number;
  qtyCcy: string;
  price: number;
  fee: number;
  change: number;
  id?: string;
}) => [
  args.date, args.exchange, "Desk", "1", "Account", args.instrument, args.type, args.side, args.qty, args.qtyCcy, args.price, args.exchange === "KGI" ? "USD" : "USDT",
  null, null, args.fee, args.exchange === "KGI" ? "USD" : "USDT", null, null, args.change, args.exchange === "KGI" ? "USD" : "USDT", null, null, args.id ?? null, null, null, null,
];

describe("full transaction Excel derivation", () => {
  it("normalizes KGI shares to contracts and moves weighted-average cost through a partial close", async () => {
    const buffer = await workbookBuffer([
      row({ date: "2026-07-01 01:00:00", exchange: "KGI", instrument: "GLD-30Sep26-450-C-USD", type: "TRADE", side: "BUY", qty: 500, qtyCcy: "GLD", price: 2, fee: 50, change: -1050 }),
      row({ date: "2026-07-02 01:00:00", exchange: "KGI", instrument: "GLD-30Sep26-450-C-USD", type: "TRADE", side: "SELL", qty: 200, qtyCcy: "GLD", price: 4, fee: 20, change: 780 }),
      row({ date: "2026-07-03 01:00:00", exchange: "KGI", instrument: "GLD-30Sep26-450-C-USD", type: "TRADE", side: "BUY", qty: 100, qtyCcy: "GLD", price: 3, fee: 10, change: -310 }),
    ]);
    const preview = await parseTransactionWorkbook(buffer, "kgi.xlsx");
    expect(preview.errors).toEqual([]);
    expect(preview.positions).toHaveLength(1);
    expect(Number(preview.positions[0].quantity)).toBe(4);
    expect(Number(preview.positions[0].entryPrice)).toBeCloseTo(2.25, 10);
    expect(Number(preview.positions[0].importedEntryCost)).toBeCloseTo(940, 10);
    expect(Number(preview.positions[0].cumulativeEntryCost)).toBeCloseTo(1360, 10);
    expect(Number(preview.positions[0].cumulativeRealizedPnl)).toBeCloseTo(360, 10);
    expect(preview.summaries[0]).toMatchObject({ underlying: "GLD", netQty: 4, openPositions: 1 });
  });

  it("realizes an expired worthless GLD option once", async () => {
    const buffer = await workbookBuffer([
      row({ date: "2026-07-02 10:00:00", exchange: "KGI", instrument: "GLD-10Jul26-395-C-USD", type: "TRADE", side: "BUY", qty: 100, qtyCcy: "GLD", price: 1.83, fee: 45.02, change: -228.02 }),
      row({ date: "2026-07-10 08:00:00", exchange: "KGI", instrument: "GLD-10Jul26-395-C-USD", type: "Withdraw", side: "SELL", qty: 100, qtyCcy: "GLD", price: 0, fee: 0, change: 0 }),
    ]);
    const preview = await parseTransactionWorkbook(buffer, "kgi-expiry.xlsx");
    expect(preview.errors).toEqual([]);
    expect(preview.positions).toHaveLength(0);
    expect(preview.summaries[0].cumulativeEntryCost).toBeCloseTo(228.02, 10);
    expect(preview.summaries[0].cumulativeRealizedPnl).toBeCloseTo(-228.02, 10);
  });

  it("uses Bybit Change as the net cash flow and preserves the open weighted entry price", async () => {
    const buffer = await workbookBuffer([
      row({ date: "2026-08-07 05:54:19", exchange: "BYBIT", instrument: "XAUT-25SEP26-4900-C-USDT", type: "TRADE", side: "BUY", qty: 10, qtyCcy: "XAUT", price: 26.5, fee: -4.25882841, change: -269.25882841, id: "buy-1" }),
      row({ date: "2026-08-21 02:41:16", exchange: "BYBIT", instrument: "XAUT-25SEP26-4900-C-USDT", type: "TRADE", side: "BUY", qty: 5, qtyCcy: "XAUT", price: 31.6, fee: -2.25625995, change: -160.25625995, id: "buy-2" }),
    ], "0");
    const preview = await parseTransactionWorkbook(buffer, "bybit.xlsx");
    expect(preview.errors).toEqual([]);
    expect(preview.positions).toHaveLength(1);
    expect(Number(preview.positions[0].quantity)).toBe(15);
    expect(Number(preview.positions[0].entryPrice)).toBeCloseTo(28.2, 10);
    expect(Number(preview.positions[0].fee)).toBeCloseTo(6.51508836, 10);
    expect(Number(preview.positions[0].importedEntryCost)).toBeCloseTo(429.51508836, 10);
    expect(preview.positions[0].entryDelta).toBe("");
    expect(preview.positions[0].dataStatus).toBe("MISSING");
  });

  it("rejects an expired position when the delivery or expiry record is missing", async () => {
    const buffer = await workbookBuffer([
      row({ date: "2026-07-01 01:00:00", exchange: "KGI", instrument: "GLD-10Jul26-395-C-USD", type: "TRADE", side: "BUY", qty: 100, qtyCcy: "GLD", price: 1.83, fee: 45.02, change: -228.02 }),
      row({ date: "2026-08-21 01:00:00", exchange: "KGI", instrument: "GLD-30Sep26-450-C-USD", type: "TRADE", side: "BUY", qty: 100, qtyCcy: "GLD", price: 2, fee: 10, change: -210 }),
    ]);
    const preview = await parseTransactionWorkbook(buffer, "missing-expiry.xlsx");
    expect(preview.errors.some(message => message.includes("已到期但仍有 Net Qty"))).toBe(true);
  });
});
