import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
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

export const technicalIndicators = pgTable("technical_indicators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe").notNull().default("1d"),
  macdValue: real("macd_value"),
  macdSignal: real("macd_signal_value"),
  macdHistogram: real("macd_histogram"),
  macdTrend: text("macd_trend"),
  rsiValue: real("rsi_value"),
  rsiTrend: text("rsi_trend"),
  ma5: real("ma5"),
  ma25: real("ma25"),
  ma75: real("ma75"),
  maTrend: text("ma_trend"),
  bbUpper: real("bb_upper"),
  bbMiddle: real("bb_middle"),
  bbLower: real("bb_lower"),
  bbTrend: text("bb_trend"),
  overallSignal: text("overall_signal"),
  overallLabel: text("overall_label"),
  calculatedAt: timestamp("calculated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_technical_ticker_timeframe").on(table.ticker, table.timeframe),
]);

export const insertTechnicalIndicatorSchema = createInsertSchema(technicalIndicators).omit({ id: true, calculatedAt: true });
export type TechnicalIndicator = typeof technicalIndicators.$inferSelect;
export type InsertTechnicalIndicator = z.infer<typeof insertTechnicalIndicatorSchema>;

export const backtestRuns = pgTable("backtest_runs", {
  runId: text("run_id").primaryKey(),
  targetPercent: real("target_percent").notNull().default(1.0),
  minBuyIndicators: integer("min_buy_indicators").notNull().default(3),
  rsiMin: real("rsi_min").notNull().default(0),
  rsiMax: real("rsi_max").notNull().default(30),
  requireMaBuy: boolean("require_ma_buy").notNull().default(false),
  simDays: integer("sim_days").notNull().default(200),
  timeframe: text("timeframe").notNull().default("1d"),
  label: text("label").notNull().default(""),
  useAi: boolean("use_ai").notNull().default(false),
  useQuantum: boolean("use_quantum").notNull().default(false),
  aiThreshold: real("ai_threshold").notNull().default(0.5),
  aiQuantumSummary: text("ai_quantum_summary"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBacktestRunSchema = createInsertSchema(backtestRuns).omit({ createdAt: true });
export type BacktestRun = typeof backtestRuns.$inferSelect;
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;

export const backtestResults = pgTable("backtest_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull(),
  signalDate: text("signal_date").notNull(),
  signalLabel: text("signal_label").notNull(),
  buyDate: text("buy_date").notNull(),
  buyPrice: real("buy_price").notNull(),
  dayHigh: real("day_high").notNull(),
  sellDate: text("sell_date").notNull(),
  sellPrice: real("sell_price").notNull(),
  profitLoss: real("profit_loss").notNull(),
  profitLossPercent: real("profit_loss_percent").notNull(),
  isWin: boolean("is_win").notNull(),
  macdTrend: text("macd_trend"),
  rsiTrend: text("rsi_trend"),
  maTrend: text("ma_trend"),
  bbTrend: text("bb_trend"),
  rsiValue: real("rsi_value"),
  aiScore: real("ai_score"),
  aiModel: text("ai_model"),
  quantumSelected: boolean("quantum_selected"),
  quantumMethod: text("quantum_method"),
  varEstimate: real("var_estimate"),
  runId: text("run_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBacktestResultSchema = createInsertSchema(backtestResults).omit({ id: true, createdAt: true });
export type BacktestResult = typeof backtestResults.$inferSelect;
export type InsertBacktestResult = z.infer<typeof insertBacktestResultSchema>;

export const intradayPrices = pgTable("intraday_prices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull(),
  datetime: text("datetime").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: integer("volume").notNull().default(0),
  interval: text("interval").notNull().default("5m"),
}, (table) => [
  uniqueIndex("idx_intraday_ticker_datetime_interval").on(table.ticker, table.datetime, table.interval),
]);

export const insertIntradayPriceSchema = createInsertSchema(intradayPrices).omit({ id: true });
export type IntradayPrice = typeof intradayPrices.$inferSelect;
export type InsertIntradayPrice = z.infer<typeof insertIntradayPriceSchema>;

export const marketRiskAssessments = pgTable("market_risk_assessments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  method: text("method").notNull(),
  riskScore: real("risk_score").notNull(),
  riskLevel: text("risk_level").notNull(),
  volatilityScore: real("volatility_score"),
  volumeScore: real("volume_score"),
  breadthScore: real("breadth_score"),
  rsiScore: real("rsi_score"),
  correlationScore: real("correlation_score"),
  details: text("details"),
  calculatedAt: timestamp("calculated_at").defaultNow(),
});

export const insertMarketRiskAssessmentSchema = createInsertSchema(marketRiskAssessments).omit({ id: true, calculatedAt: true });
export type MarketRiskAssessment = typeof marketRiskAssessments.$inferSelect;
export type InsertMarketRiskAssessment = z.infer<typeof insertMarketRiskAssessmentSchema>;

export const quantumBenchmarkRuns = pgTable("quantum_benchmark_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runAt: timestamp("run_at").defaultNow(),
  dataSource: text("data_source").notNull().default("synthetic"),
  riskResult: text("risk_result"),
  portfolioResult: text("portfolio_result"),
  varResult: text("var_result"),
  kernelResult: text("kernel_result"),
  scalingResult: text("scaling_result"),
  summary: text("summary"),
  stockCount: integer("stock_count").default(0),
  executionTimeMs: integer("execution_time_ms").default(0),
});

export const insertQuantumBenchmarkRunSchema = createInsertSchema(quantumBenchmarkRuns).omit({ id: true, runAt: true });
export type QuantumBenchmarkRun = typeof quantumBenchmarkRuns.$inferSelect;
export type InsertQuantumBenchmarkRun = z.infer<typeof insertQuantumBenchmarkRunSchema>;

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
