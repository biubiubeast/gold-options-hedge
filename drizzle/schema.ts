import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Option positions table - stores user's XAUT and GLD option positions */
export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  underlying: mysqlEnum("underlying", ["XAUT", "GLD"]).notNull(),
  expiry: varchar("expiry", { length: 20 }).notNull(), // e.g. "2026-09-25"
  strike: decimal("strike", { precision: 12, scale: 2 }).notNull(),
  optionType: mysqlEnum("optionType", ["call", "put"]).notNull(),
  entryPrice: decimal("entryPrice", { precision: 14, scale: 6 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull(),
  fee: decimal("fee", { precision: 12, scale: 6 }).default("0").notNull(),
  entryDelta: decimal("entryDelta", { precision: 8, scale: 6 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

/** Formulas table - stores customizable calculation formulas */
export const formulas = mysqlTable("formulas", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(), // e.g. "greeks", "conversion", "valuation"
  expression: text("expression").notNull(), // formula expression/code
  description: text("description"), // human-readable description
  usedIn: text("usedIn"), // where this formula is used
  isDefault: int("isDefault").default(1).notNull(), // 1 = using default, 0 = customized
  defaultExpression: text("defaultExpression").notNull(), // original default formula
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Formula = typeof formulas.$inferSelect;
export type InsertFormula = typeof formulas.$inferInsert;
