import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import {
  getGldOptionQuotes,
  getGldOptionChain,
  getGldPrice,
  getGoldPrice,
  getMarketSources,
  getXautOptionInstruments,
  getXautOptionChain,
  getXautOptionTickers,
  getXautSpotPrice,
} from "./marketData";
import { DEFAULT_FORMULAS } from "@shared/marketTypes";
import { validateFormula } from "@shared/formulaEngine";
import { createPositionWorkbook, parsePositionWorkbook } from "./positionExcel";
import { refreshPositionMarketData } from "./positionMarketRefresh";

const numericString = z.string().trim().refine(value => {
  const parsed = Number(value);
  return Number.isFinite(parsed);
}, "必须是有效数字");

const positionFields = {
  underlying: z.enum(["XAUT", "GLD"]),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD"),
  strike: numericString.refine(value => Number(value) > 0, "行权价必须大于 0"),
  optionType: z.enum(["call", "put"]),
  entryPrice: numericString.refine(value => Number(value) >= 0, "买入价格不能小于 0"),
  quantity: numericString.refine(value => Number(value) !== 0, "数量不能为 0"),
  fee: numericString.refine(value => Number(value) >= 0, "手续费不能小于 0").default("0"),
  entryDelta: numericString.refine(value => Number(value) >= -1 && Number(value) <= 1, "Delta 必须在 -1 到 1 之间"),
};

const nullableText = z.string().trim().max(500).nullable();
const nullableNumericText = z.string().trim().refine(value => value === "" || Number.isFinite(Number(value)), "必须是有效数字").nullable();
const optionalPositionFields = {
  sourceAccount: nullableText.optional(),
  venue: nullableText.optional(),
  instrument: nullableText.optional(),
  product: nullableText.optional(),
  currency: z.enum(["USD", "USDT"]).nullable().optional(),
  qtyLong: nullableNumericText.optional(),
  qtyShort: nullableNumericText.optional(),
  multiplierXau: nullableNumericText.optional(),
  xauEqNetQty: nullableNumericText.optional(),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  importedMarkPrice: nullableNumericText.optional(),
  markIv: nullableNumericText.optional(),
  bid1Price: nullableNumericText.optional(),
  ask1Price: nullableNumericText.optional(),
  marketQuoteTime: nullableText.optional(),
  marketSource: nullableText.optional(),
  lastMarketRefreshAt: nullableText.optional(),
  openInterest: nullableNumericText.optional(),
  optionVolume: nullableNumericText.optional(),
  importedMarketValue: nullableNumericText.optional(),
  entryValue: nullableNumericText.optional(),
  importedEntryCost: nullableNumericText.optional(),
  importedUnrealizedPnl: nullableNumericText.optional(),
  importedUnrealizedPnlPct: nullableNumericText.optional(),
  importedTotalDeltaXau: nullableNumericText.optional(),
  importedTotalGammaXau: nullableNumericText.optional(),
  importedTotalThetaUsdDay: nullableNumericText.optional(),
  importedTotalVegaUsdVol: nullableNumericText.optional(),
  unitGamma: nullableNumericText.optional(),
  unitTheta: nullableNumericText.optional(),
  unitVega: nullableNumericText.optional(),
  contractMultiplier: nullableNumericText.optional(),
  rawMarginMode: nullableText.optional(),
  rawMarginType: nullableText.optional(),
  importSource: nullableText.optional(),
  importRow: z.number().int().positive().nullable().optional(),
  dataStatus: z.enum(["LIVE", "STALE", "WARN", "MISSING", "FAIL"]).optional(),
};
const importedPositionSchema = z.object({
  ...positionFields,
  sourceAccount: nullableText,
  venue: nullableText,
  instrument: z.string().trim().min(1).max(500),
  product: nullableText,
  currency: z.enum(["USD", "USDT"]),
  qtyLong: nullableNumericText,
  qtyShort: nullableNumericText,
  multiplierXau: nullableNumericText,
  xauEqNetQty: nullableNumericText,
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  importedMarkPrice: nullableNumericText,
  importedMarketValue: nullableNumericText,
  entryValue: nullableNumericText,
  importedEntryCost: nullableNumericText,
  importedUnrealizedPnl: nullableNumericText,
  importedUnrealizedPnlPct: nullableNumericText,
  importedTotalDeltaXau: nullableNumericText,
  importedTotalGammaXau: nullableNumericText,
  importedTotalThetaUsdDay: nullableNumericText,
  importedTotalVegaUsdVol: nullableNumericText,
  unitGamma: nullableNumericText,
  unitTheta: nullableNumericText,
  unitVega: nullableNumericText,
  contractMultiplier: nullableNumericText,
  rawMarginMode: nullableText,
  rawMarginType: nullableText,
  importSource: nullableText,
  importRow: z.number().int().positive().nullable(),
  dataStatus: z.enum(["LIVE", "STALE", "WARN", "MISSING", "FAIL"]),
});

const formulaInput = z.object({
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "公式名只能使用字母、数字和下划线，且不能以数字开头"),
  category: z.enum(["greeks", "valuation", "conversion", "custom"]),
  expression: z.string().trim().min(1).max(1000),
  description: z.string().trim().max(500).optional(),
  usedIn: z.string().trim().max(500).optional(),
});

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),
    logout: publicProcedure.mutation(() => ({ success: true } as const)),
  }),

  positions: router({
    list: protectedProcedure.query(({ ctx }) => db.getPositionsByUser(ctx.user.id)),
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(({ ctx, input }) =>
      db.getPositionById(input.id, ctx.user.id),
    ),
    create: protectedProcedure.input(z.object({ ...positionFields, ...optionalPositionFields })).mutation(async ({ ctx, input }) => ({
      id: await db.createPosition({ userId: ctx.user.id, ...input }),
    })),
    update: protectedProcedure.input(z.object({
      id: z.number().int().positive(),
      underlying: positionFields.underlying.optional(),
      expiry: positionFields.expiry.optional(),
      strike: positionFields.strike.optional(),
      optionType: positionFields.optionType.optional(),
      entryPrice: positionFields.entryPrice.optional(),
      quantity: positionFields.quantity.optional(),
      fee: positionFields.fee.optional(),
      entryDelta: positionFields.entryDelta.optional(),
      ...optionalPositionFields,
    })).mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await db.updatePosition(id, ctx.user.id, data);
      return { success: true } as const;
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await db.deletePosition(input.id, ctx.user.id);
      return { success: true } as const;
    }),
    export: protectedProcedure.query(({ ctx }) => db.exportPortfolio(ctx.user.id)),
    previewExcel: protectedProcedure.input(z.object({
      fileName: z.string().trim().min(1).max(255).refine(value => /\.xlsx$/i.test(value), "只支持 .xlsx 文件"),
      base64: z.string().min(1).max(18_000_000),
    })).mutation(async ({ input }) => {
      const buffer = Buffer.from(input.base64, "base64");
      if (buffer.byteLength > 12_000_000) throw new Error("Excel 文件不能超过 12 MB");
      return parsePositionWorkbook(buffer, input.fileName);
    }),
    importExcel: protectedProcedure.input(z.object({
      mode: z.enum(["replace", "upsert"]),
      positions: z.array(importedPositionSchema).min(1).max(2_000),
    })).mutation(({ ctx, input }) => db.importPositions(ctx.user.id, input.positions, input.mode)),
    refreshMarketData: protectedProcedure.mutation(async ({ ctx }) => {
      const positions = await db.getPositionsByUser(ctx.user.id);
      return refreshPositionMarketData(ctx.user.id, positions);
    }),
    exportExcel: protectedProcedure.query(async ({ ctx }) => {
      const positions = await db.getPositionsByUser(ctx.user.id);
      const workbook = await createPositionWorkbook(positions);
      return {
        fileName: `DinoSignal持仓_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64: workbook.toString("base64"),
      };
    }),
  }),

  market: router({
    xautTickers: publicProcedure.query(getXautOptionTickers),
    xautInstruments: publicProcedure.query(getXautOptionInstruments),
    xautSpot: publicProcedure.query(getXautSpotPrice),
    gldPrice: publicProcedure.query(getGldPrice),
    goldPrice: publicProcedure.query(getGoldPrice),
    gldOptionQuotes: publicProcedure
      .input(z.object({
        expiries: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(24),
        contracts: z.array(z.object({
          expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          strike: z.number().positive(),
          optionType: z.enum(["call", "put"]),
        })).max(100).optional(),
      }))
      .query(({ input }) => getGldOptionQuotes(input.expiries, input.contracts)),
    gldOptionChain: protectedProcedure.query(getGldOptionChain),
    xautOptionChain: protectedProcedure.query(getXautOptionChain),
    spotPrices: publicProcedure.query(async () => {
      const [xaut, gld, gold] = await Promise.all([getXautSpotPrice(), getGldPrice(), getGoldPrice()]);
      return { xaut, gld, gold };
    }),
    sources: publicProcedure.query(getMarketSources),
  }),

  formulas: router({
    list: protectedProcedure.query(({ ctx }) => db.getFormulasByUser(ctx.user.id)),
    create: protectedProcedure.input(formulaInput).mutation(async ({ ctx, input }) => {
      if (DEFAULT_FORMULAS.some(formula => formula.name === input.name)) {
        throw new Error("该名称属于内置公式，请直接编辑内置公式");
      }
      const formulas = await db.getFormulasByUser(ctx.user.id);
      if (formulas.some(formula => formula.name === input.name)) throw new Error("公式名已存在");
      const validation = validateFormula(input.expression, [
        ...formulas,
        { name: input.name, expression: input.expression },
      ]);
      if (!validation.valid) throw new Error(`公式无效：${validation.error}`);
      const id = await db.upsertFormula({
        userId: ctx.user.id,
        name: input.name,
        category: input.category,
        expression: input.expression,
        description: input.description || null,
        usedIn: input.usedIn || "供其他公式引用",
        isDefault: 0,
        defaultExpression: input.expression,
      });
      return { id };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number().int().positive(),
      expression: z.string().trim().min(1).max(1000),
      description: z.string().trim().max(500).optional(),
      usedIn: z.string().trim().max(500).optional(),
    })).mutation(async ({ ctx, input }) => {
      const formulas = await db.getFormulasByUser(ctx.user.id);
      const current = formulas.find(formula => formula.id === input.id);
      if (!current) throw new Error("公式不存在");
      const nextFormulas = formulas.map(formula => formula.id === input.id
        ? { ...formula, expression: input.expression }
        : formula,
      );
      const validation = validateFormula(input.expression, nextFormulas);
      if (!validation.valid) throw new Error(`公式无效：${validation.error}`);
      await db.updateFormula(input.id, ctx.user.id, input);
      return { success: true } as const;
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const formulas = await db.getFormulasByUser(ctx.user.id);
      const remaining = formulas.filter(formula => formula.id !== input.id);
      for (const formula of remaining) {
        const validation = validateFormula(formula.expression, remaining);
        if (!validation.valid && validation.error.includes("未知变量或公式")) {
          throw new Error(`无法删除：公式 ${formula.name} 仍引用该公式`);
        }
      }
      await db.deleteFormula(input.id, ctx.user.id);
      return { success: true } as const;
    }),
    reset: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await db.resetFormula(input.id, ctx.user.id);
      return { success: true } as const;
    }),
    resetAll: protectedProcedure.mutation(async ({ ctx }) => {
      await db.resetAllFormulas(ctx.user.id);
      return { success: true } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
