import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const stocks = pgTable("stocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull().unique(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  currentPrice: real("current_price").notNull(),
  previousClose: real("previous_close").notNull(),
  dayHigh: real("day_high").notNull(),
  dayLow: real("day_low").notNull(),
  volume: integer("volume").notNull().default(0),
  isWatched: boolean("is_watched").notNull().default(false),
});

export const strategies = pgTable("strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  stockTicker: text("stock_ticker").notNull(),
  type: text("type").notNull(),
  buyCondition: real("buy_condition").notNull(),
  sellCondition: real("sell_condition").notNull(),
  quantity: integer("quantity").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const trades = pgTable("trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stockTicker: text("stock_ticker").notNull(),
  strategyId: varchar("strategy_id"),
  side: text("side").notNull(),
  price: real("price").notNull(),
  quantity: integer("quantity").notNull(),
  total: real("total").notNull(),
  executedAt: timestamp("executed_at").defaultNow(),
});

export const portfolioPositions = pgTable("portfolio_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stockTicker: text("stock_ticker").notNull().unique(),
  quantity: integer("quantity").notNull(),
  avgPrice: real("avg_price").notNull(),
  currentPrice: real("current_price").notNull(),
});

export const insertStockSchema = createInsertSchema(stocks).omit({ id: true });
export const insertStrategySchema = createInsertSchema(strategies).omit({ id: true, createdAt: true });
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true, executedAt: true });
export const insertPortfolioPositionSchema = createInsertSchema(portfolioPositions).omit({ id: true });

export type Stock = typeof stocks.$inferSelect;
export type InsertStock = z.infer<typeof insertStockSchema>;
export type Strategy = typeof strategies.$inferSelect;
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type PortfolioPosition = typeof portfolioPositions.$inferSelect;
export type InsertPortfolioPosition = z.infer<typeof insertPortfolioPositionSchema>;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
