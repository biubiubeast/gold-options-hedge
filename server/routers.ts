import {
  adminProcedure,
  publicProcedure,
  protectedProcedure,
  router,
} from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
  getBtcOptionInstruments,
  getBtcOptionChain,
  getBtcOptionTickers,
  getBtcSpotPrice,
  getEthOptionInstruments,
  getEthOptionChain,
  getEthOptionTickers,
  getEthSpotPrice,
  getDeribitBtcOptionChain,
  getDeribitEthOptionChain,
} from "./marketData";
import { DEFAULT_FORMULAS } from "@shared/marketTypes";
import {
  evaluateNamedFormula,
  resolveGldContractMultiplier,
  resolveGldXauMultiplier,
  resolveXautContractMultiplier,
  resolveXautXauMultiplier,
  validateFormula,
} from "@shared/formulaEngine";
import { createPositionWorkbook, parsePositionWorkbook } from "./positionExcel";
import { parseTransactionWorkbook } from "./transactionExcel";
import {
  recalculatePositionFormulaData,
  refreshPositionMarketData,
} from "./positionMarketRefresh";
import { createAuthSession, revokeAuthToken } from "./auth";
import {
  fetchResearchMarketHistory,
  fetchSignalPlusDay,
  fetchSignalPlusStrikeSnapshot,
  getMaxPainCoverage,
} from "./maxPainResearchService";

const numericString = z
  .string()
  .trim()
  .refine(value => {
    const parsed = Number(value);
    return Number.isFinite(parsed);
  }, "必须是有效数字");
const deltaOrMissingString = z
  .string()
  .trim()
  .refine(value => {
    if (value === "") return true;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= -1 && parsed <= 1;
  }, "Delta 必须为空或在 -1 到 1 之间");

const positiveConstantFormulaNames = new Set([
  "gld_xau_multiplier",
  "xaut_xau_multiplier",
  "gld_contract_multiplier",
  "xaut_contract_multiplier",
]);

const positionFields = {
  underlying: z.enum(["XAUT", "GLD", "BTC"]),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD"),
  strike: numericString.refine(value => Number(value) > 0, "行权价必须大于 0"),
  optionType: z.enum(["call", "put"]),
  entryPrice: numericString.refine(
    value => Number(value) >= 0,
    "买入价格不能小于 0"
  ),
  quantity: numericString.refine(value => Number(value) !== 0, "数量不能为 0"),
  fee: numericString
    .refine(value => Number(value) >= 0, "手续费不能小于 0")
    .default("0"),
  entryDelta: numericString.refine(
    value => Number(value) >= -1 && Number(value) <= 1,
    "Delta 必须在 -1 到 1 之间"
  ),
};

const nullableText = z.string().trim().max(500).nullable();
const nullableNumericText = z
  .string()
  .trim()
  .refine(
    value => value === "" || Number.isFinite(Number(value)),
    "必须是有效数字"
  )
  .nullable();
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
  referenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
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
  cumulativeEntryCost: nullableNumericText.optional(),
  cumulativeRealizedPnl: nullableNumericText.optional(),
  rawMarginMode: nullableText.optional(),
  rawMarginType: nullableText.optional(),
  importSource: nullableText.optional(),
  importRow: z.number().int().positive().nullable().optional(),
  dataStatus: z.enum(["LIVE", "STALE", "WARN", "MISSING", "FAIL"]).optional(),
};
const importedPositionSchema = z.object({
  ...positionFields,
  // Full transaction files do not carry live Greeks. Preserve MISSING rather
  // than manufacturing a zero delta; the market refresh can populate it later.
  entryDelta: deltaOrMissingString,
  sourceAccount: nullableText,
  venue: nullableText,
  instrument: z.string().trim().min(1).max(500),
  product: nullableText,
  currency: z.enum(["USD", "USDT"]),
  qtyLong: nullableNumericText,
  qtyShort: nullableNumericText,
  multiplierXau: nullableNumericText,
  xauEqNetQty: nullableNumericText,
  referenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
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
  cumulativeEntryCost: nullableNumericText,
  cumulativeRealizedPnl: nullableNumericText,
  rawMarginMode: nullableText,
  rawMarginType: nullableText,
  importSource: nullableText,
  importRow: z.number().int().positive().nullable(),
  dataStatus: z.enum(["LIVE", "STALE", "WARN", "MISSING", "FAIL"]),
});

const transactionSummarySchema = z.object({
  underlying: z.enum(["XAUT", "GLD", "BTC"]),
  source: z.enum(["KGI", "BYBIT"]),
  sheetName: z.string().trim().min(1).max(255),
  sourceAccount: z.string().trim().min(1).max(255),
  venue: z.string().trim().min(1).max(500),
  currency: z.enum(["USD", "USDT"]),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tradeRows: z.number().int().nonnegative(),
  ignoredRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  openPositions: z.number().int().nonnegative(),
  netQty: z.number().finite(),
  currentEntryCost: z.number().finite(),
  cumulativeEntryCost: z.number().finite(),
  cumulativeRealizedPnl: z.number().finite(),
});

const formulaInput = z.object({
  name: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "公式名只能使用字母、数字和下划线，且不能以数字开头"
    ),
  category: z.enum(["greeks", "valuation", "conversion", "custom"]),
  expression: z.string().trim().min(1).max(1000),
  description: z.string().trim().max(500).optional(),
  usedIn: z.string().trim().max(500).optional(),
});

const viewerPagePermissionsInput = z.object({
  dashboard: z.boolean(),
  positions: z.boolean(),
  matrix: z.boolean(),
  tradingView: z.boolean(),
  maxPain: z.boolean(),
  formulas: z.boolean(),
  dataSources: z.boolean(),
});

export const appRouter = router({
  auth: router({
    login: publicProcedure
      .input(
        z.object({
          username: z.string().trim().min(1).max(64),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(({ input }) => {
        const session = createAuthSession(input.username, input.password);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "用户名或密码错误",
          });
        return session;
      }),
    me: publicProcedure.query(({ ctx }) => ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      revokeAuthToken(ctx.authToken);
      return { success: true } as const;
    }),
  }),

  access: router({
    viewerPages: protectedProcedure.query(() => db.getViewerPagePermissions()),
    updateViewerPages: adminProcedure
      .input(viewerPagePermissionsInput)
      .mutation(({ input }) => db.updateViewerPagePermissions(input)),
  }),

  positions: router({
    list: protectedProcedure.query(({ ctx }) =>
      db.getPositionsByUser(ctx.user.id)
    ),
    transactionSummaries: protectedProcedure.query(({ ctx }) =>
      db.getTransactionSummaries(ctx.user.id)
    ),
    get: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ ctx, input }) => db.getPositionById(input.id, ctx.user.id)),
    create: protectedProcedure
      .input(z.object({ ...positionFields, ...optionalPositionFields }))
      .mutation(async ({ ctx, input }) => ({
        id: await db.createPosition({ userId: ctx.user.id, ...input }),
      })),
    update: protectedProcedure
      .input(
        z.object({
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
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await db.updatePosition(id, ctx.user.id, data);
        return { success: true } as const;
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await db.deletePosition(input.id, ctx.user.id);
        return { success: true } as const;
      }),
    export: protectedProcedure.query(({ ctx }) =>
      db.exportPortfolio(ctx.user.id)
    ),
    previewExcel: protectedProcedure
      .input(
        z.object({
          fileName: z
            .string()
            .trim()
            .min(1)
            .max(255)
            .refine(value => /\.xlsx$/i.test(value), "只支持 .xlsx 文件"),
          base64: z.string().min(1).max(18_000_000),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        if (buffer.byteLength > 12_000_000)
          throw new Error("Excel 文件不能超过 12 MB");
        return parsePositionWorkbook(buffer, input.fileName);
      }),
    importExcel: protectedProcedure
      .input(
        z.object({
          mode: z.enum(["replace", "upsert"]),
          positions: z.array(importedPositionSchema).min(1).max(2_000),
        })
      )
      .mutation(({ ctx, input }) =>
        db.importPositions(ctx.user.id, input.positions, input.mode)
      ),
    previewTransactions: protectedProcedure
      .input(
        z.object({
          fileName: z
            .string()
            .trim()
            .min(1)
            .max(255)
            .refine(value => /\.xlsx$/i.test(value), "只支持 .xlsx 文件"),
          base64: z.string().min(1).max(18_000_000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        if (buffer.byteLength > 12_000_000)
          throw new Error("Excel 文件不能超过 12 MB");
        const formulas = await db.getFormulasByUser(ctx.user.id);
        return parseTransactionWorkbook(buffer, input.fileName, {
          gldMultiplierXau: resolveGldXauMultiplier(formulas),
          xautMultiplierXau: resolveXautXauMultiplier(formulas),
          gldContractMultiplier: resolveGldContractMultiplier(formulas),
          xautContractMultiplier: resolveXautContractMultiplier(formulas),
        });
      }),
    importTransactions: protectedProcedure
      .input(
        z.object({
          fileName: z.string().trim().min(1).max(255),
          positions: z.array(importedPositionSchema).max(2_000),
          summaries: z.array(transactionSummarySchema).min(1).max(3),
        })
      )
      .mutation(({ ctx, input }) =>
        db.importTransactionPositions(
          ctx.user.id,
          input.positions,
          input.summaries,
          input.fileName
        )
      ),
    refreshMarketData: protectedProcedure
      .input(
        z
          .object({
            gldMultiplierXau: z.number().positive().nullable().optional(),
            xautMultiplierXau: z.number().positive().nullable().optional(),
            btcMultiplierXau: z.number().positive().nullable().optional(),
          })
          .optional()
      )
      .mutation(async ({ ctx, input }) => {
        const positions = await db.getPositionsByUser(ctx.user.id);
        const formulas = await db.getFormulasByUser(ctx.user.id);
        return refreshPositionMarketData(
          ctx.user.id,
          positions,
          input,
          formulas
        );
      }),
    exportExcel: protectedProcedure.query(async ({ ctx }) => {
      const positions = await db.getPositionsByUser(ctx.user.id);
      const formulas = await db.getFormulasByUser(ctx.user.id);
      const transactionSummaries = await db.getTransactionSummaries(
        ctx.user.id
      );
      const workbook = await createPositionWorkbook(
        positions,
        formulas,
        transactionSummaries
      );
      return {
        fileName: `DinoSignal持仓_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.xlsx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64: workbook.toString("base64"),
      };
    }),
  }),

  market: router({
    xautTickers: protectedProcedure.query(getXautOptionTickers),
    xautInstruments: protectedProcedure.query(getXautOptionInstruments),
    xautSpot: protectedProcedure.query(getXautSpotPrice),
    btcTickers: protectedProcedure.query(getBtcOptionTickers),
    btcInstruments: protectedProcedure.query(getBtcOptionInstruments),
    btcSpot: protectedProcedure.query(getBtcSpotPrice),
    ethTickers: protectedProcedure.query(getEthOptionTickers),
    ethInstruments: protectedProcedure.query(getEthOptionInstruments),
    ethSpot: protectedProcedure.query(getEthSpotPrice),
    gldPrice: protectedProcedure.query(getGldPrice),
    goldPrice: protectedProcedure.query(getGoldPrice),
    gldOptionQuotes: protectedProcedure
      .input(
        z.object({
          expiries: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(24),
          contracts: z
            .array(
              z.object({
                expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                strike: z.number().positive(),
                optionType: z.enum(["call", "put"]),
              })
            )
            .max(100)
            .optional(),
        })
      )
      .query(({ input }) =>
        getGldOptionQuotes(input.expiries, input.contracts)
      ),
    gldOptionChain: protectedProcedure.query(getGldOptionChain),
    xautOptionChain: protectedProcedure.query(getXautOptionChain),
    btcOptionChain: protectedProcedure.query(getBtcOptionChain),
    ethOptionChain: protectedProcedure.query(getEthOptionChain),
    deribitBtcOptionChain: protectedProcedure.query(getDeribitBtcOptionChain),
    deribitEthOptionChain: protectedProcedure.query(getDeribitEthOptionChain),
    spotPrices: protectedProcedure.query(async () => {
      const [xaut, gld, gold, btc, eth] = await Promise.all([
        getXautSpotPrice(),
        getGldPrice(),
        getGoldPrice(),
        getBtcSpotPrice(),
        getEthSpotPrice(),
      ]);
      return { xaut, gld, gold, btc, eth };
    }),
    sources: protectedProcedure.query(getMarketSources),
  }),

  maxPainResearch: router({
    coverage: protectedProcedure.query(getMaxPainCoverage),
    intradayDay: protectedProcedure
      .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
      .query(({ input }) => fetchSignalPlusDay(input.date)),
    strikeSnapshot: protectedProcedure
      .input(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          hourUtc: z.union([
            z.literal(0),
            z.literal(4),
            z.literal(8),
            z.literal(12),
            z.literal(16),
            z.literal(20),
          ]),
        })
      )
      .query(({ input }) =>
        fetchSignalPlusStrikeSnapshot(input.date, input.hourUtc)
      ),
    marketHistory: protectedProcedure
      .input(
        z.object({
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          interval: z.enum(["1h", "4h", "12h", "1d"]),
        })
      )
      .query(({ input }) =>
        fetchResearchMarketHistory(
          input.startDate,
          input.endDate,
          input.interval
        )
      ),
  }),

  formulas: router({
    list: protectedProcedure.query(({ ctx }) =>
      db.getFormulasByUser(ctx.user.id)
    ),
    create: adminProcedure
      .input(formulaInput)
      .mutation(async ({ ctx, input }) => {
        if (DEFAULT_FORMULAS.some(formula => formula.name === input.name)) {
          throw new Error("该名称属于内置公式，请直接编辑内置公式");
        }
        const formulas = await db.getFormulasByUser(ctx.user.id);
        if (formulas.some(formula => formula.name === input.name))
          throw new Error("公式名已存在");
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
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          expression: z.string().trim().min(1).max(1000),
          description: z.string().trim().max(500).optional(),
          usedIn: z.string().trim().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const formulas = await db.getFormulasByUser(ctx.user.id);
        const current = formulas.find(formula => formula.id === input.id);
        if (!current) throw new Error("公式不存在");
        const nextFormulas = formulas.map(formula =>
          formula.id === input.id
            ? { ...formula, expression: input.expression }
            : formula
        );
        const validation = validateFormula(input.expression, nextFormulas);
        if (!validation.valid) throw new Error(`公式无效：${validation.error}`);
        if (positiveConstantFormulaNames.has(current.name)) {
          let multiplier: number;
          try {
            multiplier = evaluateNamedFormula(
              current.name,
              {},
              nextFormulas,
              new Set()
            );
          } catch {
            throw new Error(
              `${current.name} 不能引用 S、现价等市场变量；请输入正数常量或仅引用其他常量公式`
            );
          }
          if (!Number.isFinite(multiplier) || multiplier <= 0) {
            throw new Error(`${current.name} 必须是不依赖市场变量的正数`);
          }
        }
        await db.updateFormula(input.id, ctx.user.id, input);
        const updatedFormulas = await db.getFormulasByUser(ctx.user.id);
        const positions = await db.getPositionsByUser(ctx.user.id);
        const recalculated = await recalculatePositionFormulaData(
          ctx.user.id,
          positions,
          updatedFormulas
        );
        return { success: true, recalculated } as const;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const formulas = await db.getFormulasByUser(ctx.user.id);
        const remaining = formulas.filter(formula => formula.id !== input.id);
        for (const formula of remaining) {
          const validation = validateFormula(formula.expression, remaining);
          if (
            !validation.valid &&
            validation.error.includes("未知变量或公式")
          ) {
            throw new Error(`无法删除：公式 ${formula.name} 仍引用该公式`);
          }
        }
        await db.deleteFormula(input.id, ctx.user.id);
        return { success: true } as const;
      }),
    reset: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await db.resetFormula(input.id, ctx.user.id);
        const formulas = await db.getFormulasByUser(ctx.user.id);
        const positions = await db.getPositionsByUser(ctx.user.id);
        const recalculated = await recalculatePositionFormulaData(
          ctx.user.id,
          positions,
          formulas
        );
        return { success: true, recalculated } as const;
      }),
    resetAll: adminProcedure.mutation(async ({ ctx }) => {
      await db.resetAllFormulas(ctx.user.id);
      const formulas = await db.getFormulasByUser(ctx.user.id);
      const positions = await db.getPositionsByUser(ctx.user.id);
      const recalculated = await recalculatePositionFormulaData(
        ctx.user.id,
        positions,
        formulas
      );
      return { success: true, recalculated } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
