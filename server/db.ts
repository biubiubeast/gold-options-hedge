import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_FORMULAS } from "@shared/marketTypes";
import type { ImportedPosition, ImportMode } from "@shared/positionExcel";

export type LocalUser = {
  id: number;
  openId: string;
  name: string;
  email: string | null;
  loginMethod: string;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

export type PositionRecord = {
  id: number;
  userId: number;
  underlying: "XAUT" | "GLD" | "BTC";
  expiry: string;
  strike: string;
  optionType: "call" | "put";
  entryPrice: string;
  quantity: string;
  fee: string;
  entryDelta: string;
  sourceAccount?: string | null;
  venue?: string | null;
  instrument?: string | null;
  product?: string | null;
  currency?: "USD" | "USDT" | null;
  qtyLong?: string | null;
  qtyShort?: string | null;
  multiplierXau?: string | null;
  xauEqNetQty?: string | null;
  referenceDate?: string | null;
  importedMarkPrice?: string | null;
  markIv?: string | null;
  bid1Price?: string | null;
  ask1Price?: string | null;
  marketQuoteTime?: string | null;
  marketSource?: string | null;
  lastMarketRefreshAt?: string | null;
  openInterest?: string | null;
  optionVolume?: string | null;
  importedMarketValue?: string | null;
  entryValue?: string | null;
  importedEntryCost?: string | null;
  importedUnrealizedPnl?: string | null;
  importedUnrealizedPnlPct?: string | null;
  importedTotalDeltaXau?: string | null;
  importedTotalGammaXau?: string | null;
  importedTotalThetaUsdDay?: string | null;
  importedTotalVegaUsdVol?: string | null;
  unitGamma?: string | null;
  unitTheta?: string | null;
  unitVega?: string | null;
  contractMultiplier?: string | null;
  rawMarginMode?: string | null;
  rawMarginType?: string | null;
  importSource?: string | null;
  importRow?: number | null;
  dataStatus?: "LIVE" | "STALE" | "WARN" | "MISSING" | "FAIL";
  createdAt: Date;
  updatedAt: Date;
};

export type PositionInput = Omit<
  PositionRecord,
  "id" | "createdAt" | "updatedAt"
>;

export type FormulaRecord = {
  id: number;
  userId: number;
  name: string;
  category: string;
  expression: string;
  description: string | null;
  usedIn: string | null;
  isDefault: number;
  defaultExpression: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FormulaInput = Omit<
  FormulaRecord,
  "id" | "createdAt" | "updatedAt"
>;

type StoredPosition = Omit<PositionRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type StoredFormula = Omit<FormulaRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type Store = {
  version: 1;
  nextPositionId: number;
  nextFormulaId: number;
  positions: StoredPosition[];
  formulas: StoredFormula[];
};

const LOCAL_USER_ID = 1;
const dataFile = path.resolve(
  process.env.DATA_FILE || path.join(process.cwd(), "data", "portfolio.json"),
);

let operationQueue: Promise<unknown> = Promise.resolve();

const emptyStore = (): Store => ({
  version: 1,
  nextPositionId: 1,
  nextFormulaId: 1,
  positions: [],
  formulas: [],
});

async function loadStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(dataFile, "utf8")) as Store;
    if (parsed.version !== 1 || !Array.isArray(parsed.positions) || !Array.isArray(parsed.formulas)) {
      throw new Error("Unsupported portfolio data format");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    console.error("[LocalStore] Portfolio data is unreadable. The file was left untouched:", error);
    throw new Error(`无法读取本地数据文件 ${dataFile}，请从备份恢复或修复 JSON`);
  }
}

async function saveStore(store: Store): Promise<void> {
  await mkdir(path.dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryFile, dataFile);
}

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(task, task);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

const inflatePosition = (value: StoredPosition): PositionRecord => ({
  ...value,
  createdAt: new Date(value.createdAt),
  updatedAt: new Date(value.updatedAt),
});

const inflateFormula = (value: StoredFormula): FormulaRecord => ({
  ...value,
  createdAt: new Date(value.createdAt),
  updatedAt: new Date(value.updatedAt),
});

async function ensureDefaultFormulas(store: Store, userId: number): Promise<boolean> {
  const existingNames = new Set(
    store.formulas.filter(formula => formula.userId === userId).map(formula => formula.name),
  );
  let changed = false;

  for (const definition of DEFAULT_FORMULAS) {
    const existing = store.formulas.find(
      formula => formula.userId === userId && formula.name === definition.name,
    );
    if (!existing) {
      const now = new Date().toISOString();
      store.formulas.push({
        id: store.nextFormulaId++,
        userId,
        name: definition.name,
        category: definition.category,
        expression: definition.expression,
        description: definition.description,
        usedIn: definition.usedIn,
        isDefault: 1,
        defaultExpression: definition.defaultExpression,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
      continue;
    }

    if (
      existing.isDefault === 1 &&
      existing.expression !== definition.defaultExpression
    ) {
      existing.expression = definition.defaultExpression;
      changed = true;
    }
    if (
      existing.defaultExpression !== definition.defaultExpression ||
      existing.description !== definition.description ||
      existing.usedIn !== definition.usedIn ||
      existing.category !== definition.category
    ) {
      existing.defaultExpression = definition.defaultExpression;
      existing.description = definition.description;
      existing.usedIn = definition.usedIn;
      existing.category = definition.category;
      existing.updatedAt = new Date().toISOString();
      changed = true;
    }
    existingNames.add(definition.name);
  }

  return changed;
}

export const localUser: LocalUser = {
  id: LOCAL_USER_ID,
  openId: "local-user",
  name: "本地投资组合",
  email: null,
  loginMethod: "local",
  role: "admin",
  createdAt: new Date(0),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

// Kept for compatibility with the old Manus helper modules. The application no
// longer needs an external database or OAuth user record.
export async function getDb() {
  return null;
}

export async function upsertUser(_user?: unknown): Promise<void> {}

export async function getUserByOpenId(_openId?: string) {
  return localUser;
}

export async function getPositionsByUser(userId: number) {
  const store = await loadStore();
  return store.positions
    .filter(position => position.userId === userId)
    .map(inflatePosition)
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || Number(a.strike) - Number(b.strike));
}

export async function getPositionById(id: number, userId: number) {
  const store = await loadStore();
  const position = store.positions.find(item => item.id === id && item.userId === userId);
  return position ? inflatePosition(position) : undefined;
}

export async function createPosition(data: PositionInput) {
  return serialize(async () => {
    const store = await loadStore();
    const now = new Date().toISOString();
    const id = store.nextPositionId++;
    store.positions.push({ ...data, id, createdAt: now, updatedAt: now });
    await saveStore(store);
    return id;
  });
}

export async function updatePosition(
  id: number,
  userId: number,
  data: Partial<Omit<PositionInput, "userId">>,
) {
  return serialize(async () => {
    const store = await loadStore();
    const position = store.positions.find(item => item.id === id && item.userId === userId);
    if (!position) throw new Error("仓位不存在");
    Object.assign(position, data, { updatedAt: new Date().toISOString() });
    await saveStore(store);
  });
}

export async function updatePositionsMarketData(
  userId: number,
  updates: Array<{ id: number; data: Partial<Omit<PositionInput, "userId">> }>,
) {
  return serialize(async () => {
    const store = await loadStore();
    const now = new Date().toISOString();
    let updated = 0;
    for (const update of updates) {
      const position = store.positions.find(item => item.id === update.id && item.userId === userId);
      if (!position) continue;
      Object.assign(position, update.data, { updatedAt: now });
      updated += 1;
    }
    if (updated > 0) await saveStore(store);
    return updated;
  });
}

export async function deletePosition(id: number, userId: number) {
  return serialize(async () => {
    const store = await loadStore();
    const next = store.positions.filter(item => !(item.id === id && item.userId === userId));
    if (next.length === store.positions.length) throw new Error("仓位不存在");
    store.positions = next;
    await saveStore(store);
  });
}

function positionIdentity(position: Pick<PositionRecord, "underlying" | "expiry" | "strike" | "optionType" | "instrument" | "sourceAccount">) {
  return position.instrument?.trim().toUpperCase()
    || [position.sourceAccount ?? "", position.underlying, position.expiry, Number(position.strike).toString(), position.optionType].join("|");
}

export async function importPositions(userId: number, positions: ImportedPosition[], mode: ImportMode) {
  return serialize(async () => {
    const store = await loadStore();
    const before = store.positions.filter(position => position.userId === userId);
    const now = new Date().toISOString();
    const backupDirectory = path.join(path.dirname(dataFile), "backups");
    await mkdir(backupDirectory, { recursive: true });
    const backupName = `portfolio-before-import-${now.replace(/[:.]/g, "-")}.json`;
    await writeFile(path.join(backupDirectory, backupName), `${JSON.stringify({ exportedAt: now, positions: before }, null, 2)}\n`, "utf8");

    const incoming = positions.map(position => ({ ...position, userId }));
    let created = 0;
    let updated = 0;
    if (mode === "replace") {
      store.positions = store.positions.filter(position => position.userId !== userId);
      for (const position of incoming) {
        store.positions.push({ ...position, id: store.nextPositionId++, createdAt: now, updatedAt: now });
        created += 1;
      }
    } else {
      for (const position of incoming) {
        const identity = positionIdentity(position);
        const existing = store.positions.find(item => item.userId === userId && positionIdentity(item) === identity);
        if (existing) {
          Object.assign(existing, position, { updatedAt: now });
          updated += 1;
        } else {
          store.positions.push({ ...position, id: store.nextPositionId++, createdAt: now, updatedAt: now });
          created += 1;
        }
      }
    }
    await saveStore(store);
    return { created, updated, removed: mode === "replace" ? before.length : 0, backupName };
  });
}

export async function getFormulasByUser(userId: number) {
  return serialize(async () => {
    const store = await loadStore();
    if (await ensureDefaultFormulas(store, userId)) await saveStore(store);
    return store.formulas
      .filter(formula => formula.userId === userId)
      .map(inflateFormula)
      .sort((a, b) => a.id - b.id);
  });
}

export async function upsertFormula(data: FormulaInput) {
  return serialize(async () => {
    const store = await loadStore();
    const existing = store.formulas.find(
      formula => formula.userId === data.userId && formula.name === data.name,
    );
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, data, { updatedAt: now });
      await saveStore(store);
      return existing.id;
    }
    const id = store.nextFormulaId++;
    store.formulas.push({ ...data, id, createdAt: now, updatedAt: now });
    await saveStore(store);
    return id;
  });
}

export async function updateFormula(
  id: number,
  userId: number,
  data: Pick<FormulaRecord, "expression"> & Partial<Pick<FormulaRecord, "description" | "usedIn">>,
) {
  return serialize(async () => {
    const store = await loadStore();
    const formula = store.formulas.find(item => item.id === id && item.userId === userId);
    if (!formula) throw new Error("公式不存在");
    Object.assign(formula, data, { isDefault: 0, updatedAt: new Date().toISOString() });
    await saveStore(store);
  });
}

export async function deleteFormula(id: number, userId: number) {
  return serialize(async () => {
    const store = await loadStore();
    const formula = store.formulas.find(item => item.id === id && item.userId === userId);
    if (!formula) throw new Error("公式不存在");
    if (DEFAULT_FORMULAS.some(definition => definition.name === formula.name)) {
      throw new Error("内置公式不能删除，可恢复默认值");
    }
    store.formulas = store.formulas.filter(item => item.id !== id);
    await saveStore(store);
  });
}

export async function resetFormula(id: number, userId: number) {
  return serialize(async () => {
    const store = await loadStore();
    const formula = store.formulas.find(item => item.id === id && item.userId === userId);
    if (!formula) throw new Error("公式不存在");
    formula.expression = formula.defaultExpression;
    formula.isDefault = 1;
    formula.updatedAt = new Date().toISOString();
    await saveStore(store);
  });
}

export async function resetAllFormulas(userId: number) {
  return serialize(async () => {
    const store = await loadStore();
    for (const formula of store.formulas.filter(item => item.userId === userId)) {
      formula.expression = formula.defaultExpression;
      formula.isDefault = 1;
      formula.updatedAt = new Date().toISOString();
    }
    await saveStore(store);
  });
}

export async function exportPortfolio(userId: number) {
  const store = await loadStore();
  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    positions: store.positions.filter(position => position.userId === userId),
    formulas: store.formulas.filter(formula => formula.userId === userId),
  };
}
