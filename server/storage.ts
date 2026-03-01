import {
  type User, type InsertUser,
  type Stock, type InsertStock,
  type Strategy, type InsertStrategy,
  type Trade, type InsertTrade,
  type PortfolioPosition, type InsertPortfolioPosition,
  type TechnicalIndicator, type InsertTechnicalIndicator,
  type BacktestResult, type InsertBacktestResult,
  type BacktestRun, type InsertBacktestRun,
  type IntradayPrice, type InsertIntradayPrice,
  type MarketRiskAssessment, type InsertMarketRiskAssessment,
  type QuantumBenchmarkRun, type InsertQuantumBenchmarkRun,
  type EnergyLog, type InsertEnergyLog,
  type CreditTransaction, type InsertCreditTransaction,
  type AppSetting,
  users, stocks, strategies, trades, portfolioPositions, technicalIndicators, backtestResults, backtestRuns, intradayPrices, marketRiskAssessments, quantumBenchmarkRuns, energyLogs, creditTransactions, appSettings,
} from "@shared/schema";
import { db } from "./db";
import { eq, sql, like, or, ilike, count, and, gte, lte, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllStocks(): Promise<Stock[]>;
  getStockByTicker(ticker: string): Promise<Stock | undefined>;
  createStock(stock: InsertStock): Promise<Stock>;
  updateStockPrice(ticker: string, price: number, high: number, low: number, volume: number): Promise<void>;
  toggleWatchStock(ticker: string, isWatched: boolean): Promise<void>;
  getAllStrategies(): Promise<Strategy[]>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  createStrategy(strategy: InsertStrategy): Promise<Strategy>;
  updateStrategyActive(id: string, isActive: boolean): Promise<void>;
  deleteStrategy(id: string): Promise<void>;
  getAllTrades(): Promise<Trade[]>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  getAllPositions(): Promise<PortfolioPosition[]>;
  getPosition(stockTicker: string): Promise<PortfolioPosition | undefined>;
  upsertPosition(ticker: string, quantity: number, avgPrice: number, currentPrice: number): Promise<void>;
  updatePositionPrice(ticker: string, currentPrice: number): Promise<void>;
  deletePosition(ticker: string): Promise<void>;
  getStockCount(): Promise<number>;
  updatePreviousClose(ticker: string, previousClose: number): Promise<void>;
  updateStockFundamentals(ticker: string, data: {
    marketCap?: number | null;
    sharesOutstanding?: number | null;
    per?: number | null;
    pbr?: number | null;
    eps?: number | null;
    dividendYield?: number | null;
    fiftyTwoWeekHigh?: number | null;
    fiftyTwoWeekLow?: number | null;
    unitShares?: number;
    marketCapCategory?: string | null;
  }): Promise<void>;
  bulkUpsertStocks(stockList: InsertStock[]): Promise<number>;
  searchStocks(query: string, limit: number, offset: number): Promise<{ stocks: Stock[]; total: number }>;
  getWatchedStocks(): Promise<Stock[]>;
  getStocksWithPrices(): Promise<Stock[]>;
  getAllStockTickers(): Promise<string[]>;
  upsertTechnicalIndicator(indicator: InsertTechnicalIndicator): Promise<void>;
  getTechnicalIndicator(ticker: string, timeframe?: string): Promise<TechnicalIndicator | undefined>;
  getAllTechnicalIndicators(timeframe?: string): Promise<TechnicalIndicator[]>;
  insertBacktestResult(result: InsertBacktestResult): Promise<void>;
  getBacktestResults(runId?: string): Promise<BacktestResult[]>;
  getBacktestRuns(): Promise<{ runId: string; count: number; wins: number; losses: number; createdAt: Date | null }[]>;
  deleteBacktestRun(runId: string): Promise<void>;
  insertBacktestRun(run: InsertBacktestRun): Promise<void>;
  updateBacktestRunSummary(runId: string, summary: string): Promise<void>;
  getBacktestRunConfig(runId: string): Promise<BacktestRun | undefined>;
  getAllBacktestRunConfigs(): Promise<BacktestRun[]>;
  bulkInsertIntradayPrices(bars: InsertIntradayPrice[]): Promise<number>;
  getIntradayPrices(ticker: string, fromDate?: string, toDate?: string, interval?: string): Promise<IntradayPrice[]>;
  getIntradayDataStats(): Promise<{ totalBars: number; distinctTickers: number; earliestDate: string | null; latestDate: string | null }>;
  cleanupOldIntradayData(retentionDays: number): Promise<number>;
  insertMarketRiskAssessment(assessment: InsertMarketRiskAssessment): Promise<void>;
  getMarketRiskAssessments(limit?: number): Promise<MarketRiskAssessment[]>;
  getLatestRiskByMethod(method: string): Promise<MarketRiskAssessment | undefined>;
  insertBenchmarkRun(run: InsertQuantumBenchmarkRun): Promise<QuantumBenchmarkRun>;
  getBenchmarkRuns(limit?: number): Promise<QuantumBenchmarkRun[]>;
  getBenchmarkRun(id: string): Promise<QuantumBenchmarkRun | undefined>;
  deleteBenchmarkRun(id: string): Promise<void>;
  insertEnergyLog(log: InsertEnergyLog): Promise<EnergyLog>;
  getEnergyLogs(limit?: number): Promise<EnergyLog[]>;
  getEnergySummary(): Promise<{ totalAiWh: number; totalQuantumWh: number; totalCo2: number; count: number }>;
  deleteEnergyLog(id: string): Promise<void>;
  clearEnergyLogs(): Promise<void>;
  getUserCredits(userId: string): Promise<number>;
  addCredits(userId: string, amount: number, description: string, stripeSessionId?: string): Promise<CreditTransaction | null>;
  deductCredits(userId: string, amount: number, description: string, taskType: string): Promise<CreditTransaction>;
  getCreditTransactions(userId: string, limit?: number): Promise<CreditTransaction[]>;
  updateUserStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string, label: string, description?: string): Promise<AppSetting>;
  getAllSettings(): Promise<AppSetting[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getAllStocks(): Promise<Stock[]> {
    return db.select().from(stocks);
  }

  async getStockByTicker(ticker: string): Promise<Stock | undefined> {
    const [stock] = await db.select().from(stocks).where(eq(stocks.ticker, ticker));
    return stock;
  }

  async createStock(stock: InsertStock): Promise<Stock> {
    const [created] = await db.insert(stocks).values(stock).returning();
    return created;
  }

  async updateStockPrice(ticker: string, price: number, high: number, low: number, volume: number): Promise<void> {
    await db.update(stocks).set({
      currentPrice: price,
      dayHigh: high,
      dayLow: low,
      volume: volume,
    }).where(eq(stocks.ticker, ticker));
  }

  async toggleWatchStock(ticker: string, isWatched: boolean): Promise<void> {
    await db.update(stocks).set({ isWatched }).where(eq(stocks.ticker, ticker));
  }

  async getAllStrategies(): Promise<Strategy[]> {
    return db.select().from(strategies);
  }

  async getStrategy(id: string): Promise<Strategy | undefined> {
    const [strategy] = await db.select().from(strategies).where(eq(strategies.id, id));
    return strategy;
  }

  async createStrategy(strategy: InsertStrategy): Promise<Strategy> {
    const [created] = await db.insert(strategies).values(strategy).returning();
    return created;
  }

  async updateStrategyActive(id: string, isActive: boolean): Promise<void> {
    await db.update(strategies).set({ isActive }).where(eq(strategies.id, id));
  }

  async deleteStrategy(id: string): Promise<void> {
    await db.delete(strategies).where(eq(strategies.id, id));
  }

  async getAllTrades(): Promise<Trade[]> {
    return db.select().from(trades);
  }

  async createTrade(trade: InsertTrade): Promise<Trade> {
    const [created] = await db.insert(trades).values(trade).returning();
    return created;
  }

  async getAllPositions(): Promise<PortfolioPosition[]> {
    return db.select().from(portfolioPositions);
  }

  async getPosition(stockTicker: string): Promise<PortfolioPosition | undefined> {
    const [pos] = await db.select().from(portfolioPositions).where(eq(portfolioPositions.stockTicker, stockTicker));
    return pos;
  }

  async upsertPosition(ticker: string, quantity: number, avgPrice: number, currentPrice: number): Promise<void> {
    const existing = await this.getPosition(ticker);
    if (existing) {
      const newQty = existing.quantity + quantity;
      if (newQty <= 0) {
        await db.delete(portfolioPositions).where(eq(portfolioPositions.stockTicker, ticker));
        return;
      }
      const newAvg = quantity > 0
        ? (existing.avgPrice * existing.quantity + avgPrice * quantity) / newQty
        : existing.avgPrice;
      await db.update(portfolioPositions).set({
        quantity: newQty,
        avgPrice: newAvg,
        currentPrice,
      }).where(eq(portfolioPositions.stockTicker, ticker));
    } else if (quantity > 0) {
      await db.insert(portfolioPositions).values({
        stockTicker: ticker,
        quantity,
        avgPrice,
        currentPrice,
      });
    }
  }

  async updatePositionPrice(ticker: string, currentPrice: number): Promise<void> {
    await db.update(portfolioPositions).set({ currentPrice }).where(eq(portfolioPositions.stockTicker, ticker));
  }

  async deletePosition(ticker: string): Promise<void> {
    await db.delete(portfolioPositions).where(eq(portfolioPositions.stockTicker, ticker));
  }

  async getStockCount(): Promise<number> {
    const result = await db.select().from(stocks);
    return result.length;
  }

  async updatePreviousClose(ticker: string, previousClose: number): Promise<void> {
    await db.update(stocks).set({ previousClose }).where(eq(stocks.ticker, ticker));
  }

  async updateStockFundamentals(ticker: string, data: {
    marketCap?: number | null;
    sharesOutstanding?: number | null;
    per?: number | null;
    pbr?: number | null;
    eps?: number | null;
    dividendYield?: number | null;
    fiftyTwoWeekHigh?: number | null;
    fiftyTwoWeekLow?: number | null;
    unitShares?: number;
    marketCapCategory?: string | null;
  }): Promise<void> {
    const updateData: any = {};
    if (data.marketCap !== undefined) updateData.marketCap = data.marketCap;
    if (data.sharesOutstanding !== undefined) updateData.sharesOutstanding = data.sharesOutstanding;
    if (data.per !== undefined) updateData.per = data.per;
    if (data.pbr !== undefined) updateData.pbr = data.pbr;
    if (data.eps !== undefined) updateData.eps = data.eps;
    if (data.dividendYield !== undefined) updateData.dividendYield = data.dividendYield;
    if (data.fiftyTwoWeekHigh !== undefined) updateData.fiftyTwoWeekHigh = data.fiftyTwoWeekHigh;
    if (data.fiftyTwoWeekLow !== undefined) updateData.fiftyTwoWeekLow = data.fiftyTwoWeekLow;
    if (data.unitShares !== undefined) updateData.unitShares = data.unitShares;
    if (data.marketCapCategory !== undefined) updateData.marketCapCategory = data.marketCapCategory;
    if (Object.keys(updateData).length > 0) {
      await db.update(stocks).set(updateData).where(eq(stocks.ticker, ticker));
    }
  }

  async bulkUpsertStocks(stockList: InsertStock[]): Promise<number> {
    let inserted = 0;
    const batchSize = 100;
    for (let i = 0; i < stockList.length; i += batchSize) {
      const batch = stockList.slice(i, i + batchSize);
      await db.insert(stocks).values(batch).onConflictDoUpdate({
        target: stocks.ticker,
        set: {
          name: sql`excluded.name`,
          sector: sql`excluded.sector`,
        },
      });
      inserted += batch.length;
    }
    return inserted;
  }

  async searchStocks(query: string, limit: number, offset: number): Promise<{ stocks: Stock[]; total: number }> {
    const pattern = `%${query}%`;
    const whereClause = query
      ? or(
          ilike(stocks.ticker, pattern),
          ilike(stocks.name, pattern),
          ilike(stocks.sector, pattern)
        )
      : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(stocks)
      .where(whereClause);

    const results = await db
      .select()
      .from(stocks)
      .where(whereClause)
      .orderBy(stocks.ticker)
      .limit(limit)
      .offset(offset);

    return { stocks: results, total: Number(totalResult.count) };
  }
  async getWatchedStocks(): Promise<Stock[]> {
    return db.select().from(stocks).where(eq(stocks.isWatched, true));
  }

  async getStocksWithPrices(): Promise<Stock[]> {
    return db.select().from(stocks).where(sql`${stocks.currentPrice} > 0`);
  }
  async getAllStockTickers(): Promise<string[]> {
    const rows = await db.select({ ticker: stocks.ticker }).from(stocks);
    return rows.map(r => r.ticker);
  }

  async upsertTechnicalIndicator(indicator: InsertTechnicalIndicator): Promise<void> {
    await db
      .insert(technicalIndicators)
      .values({ ...indicator, timeframe: indicator.timeframe || "1d" })
      .onConflictDoUpdate({
        target: [technicalIndicators.ticker, technicalIndicators.timeframe],
        set: {
          macdValue: indicator.macdValue,
          macdSignal: indicator.macdSignal,
          macdHistogram: indicator.macdHistogram,
          macdTrend: indicator.macdTrend,
          rsiValue: indicator.rsiValue,
          rsiTrend: indicator.rsiTrend,
          ma5: indicator.ma5,
          ma25: indicator.ma25,
          ma75: indicator.ma75,
          maTrend: indicator.maTrend,
          bbUpper: indicator.bbUpper,
          bbMiddle: indicator.bbMiddle,
          bbLower: indicator.bbLower,
          bbTrend: indicator.bbTrend,
          overallSignal: indicator.overallSignal,
          overallLabel: indicator.overallLabel,
          calculatedAt: sql`now()`,
        },
      });
  }

  async getTechnicalIndicator(ticker: string, timeframe: string = "1d"): Promise<TechnicalIndicator | undefined> {
    const [row] = await db.select().from(technicalIndicators)
      .where(and(eq(technicalIndicators.ticker, ticker), eq(technicalIndicators.timeframe, timeframe)));
    return row;
  }

  async getAllTechnicalIndicators(timeframe?: string): Promise<TechnicalIndicator[]> {
    if (timeframe) {
      return db.select().from(technicalIndicators).where(eq(technicalIndicators.timeframe, timeframe));
    }
    return db.select().from(technicalIndicators);
  }

  async insertBacktestResult(result: InsertBacktestResult): Promise<void> {
    await db.insert(backtestResults).values(result);
  }

  async getBacktestResults(runId?: string): Promise<BacktestResult[]> {
    if (runId) {
      return db.select().from(backtestResults).where(eq(backtestResults.runId, runId));
    }
    return db.select().from(backtestResults);
  }

  async getBacktestRuns(): Promise<{ runId: string; count: number; wins: number; losses: number; createdAt: Date | null }[]> {
    const rows = await db
      .select({
        runId: backtestResults.runId,
        count: count(),
        wins: sql<number>`count(*) filter (where ${backtestResults.isWin} = true)`,
        losses: sql<number>`count(*) filter (where ${backtestResults.isWin} = false)`,
        createdAt: sql<Date | null>`min(${backtestResults.createdAt})`,
      })
      .from(backtestResults)
      .groupBy(backtestResults.runId)
      .orderBy(sql`min(${backtestResults.createdAt}) desc`);
    return rows.map(r => ({ ...r, count: Number(r.count), wins: Number(r.wins), losses: Number(r.losses) }));
  }

  async deleteBacktestRun(runId: string): Promise<void> {
    await db.delete(backtestResults).where(eq(backtestResults.runId, runId));
    await db.delete(backtestRuns).where(eq(backtestRuns.runId, runId));
  }

  async insertBacktestRun(run: InsertBacktestRun): Promise<void> {
    await db.insert(backtestRuns).values(run);
  }

  async updateBacktestRunSummary(runId: string, summary: string): Promise<void> {
    await db.update(backtestRuns).set({ aiQuantumSummary: summary }).where(eq(backtestRuns.runId, runId));
  }

  async getBacktestRunConfig(runId: string): Promise<BacktestRun | undefined> {
    const [row] = await db.select().from(backtestRuns).where(eq(backtestRuns.runId, runId));
    return row;
  }

  async getAllBacktestRunConfigs(): Promise<BacktestRun[]> {
    return db.select().from(backtestRuns).orderBy(sql`${backtestRuns.createdAt} desc`);
  }

  async bulkInsertIntradayPrices(bars: InsertIntradayPrice[]): Promise<number> {
    if (bars.length === 0) return 0;
    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < bars.length; i += batchSize) {
      const batch = bars.slice(i, i + batchSize);
      const result = await db.insert(intradayPrices).values(batch).onConflictDoNothing();
      inserted += Number(result.rowCount ?? 0);
    }
    return inserted;
  }

  async getIntradayPrices(ticker: string, fromDate?: string, toDate?: string, interval?: string): Promise<IntradayPrice[]> {
    const conditions = [eq(intradayPrices.ticker, ticker)];
    if (fromDate) conditions.push(gte(intradayPrices.datetime, fromDate));
    if (toDate) conditions.push(lte(intradayPrices.datetime, toDate));
    if (interval) conditions.push(eq(intradayPrices.interval, interval));
    return db.select().from(intradayPrices)
      .where(and(...conditions))
      .orderBy(intradayPrices.datetime);
  }

  async getIntradayDataStats(): Promise<{ totalBars: number; distinctTickers: number; earliestDate: string | null; latestDate: string | null }> {
    const [result] = await db.select({
      totalBars: count(),
      distinctTickers: sql<number>`count(distinct ${intradayPrices.ticker})`,
      earliestDate: sql<string | null>`min(${intradayPrices.datetime})`,
      latestDate: sql<string | null>`max(${intradayPrices.datetime})`,
    }).from(intradayPrices);
    return {
      totalBars: Number(result.totalBars),
      distinctTickers: Number(result.distinctTickers),
      earliestDate: result.earliestDate,
      latestDate: result.latestDate,
    };
  }

  async cleanupOldIntradayData(retentionDays: number): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString().split("T")[0];
    const result = await db.delete(intradayPrices).where(sql`${intradayPrices.datetime} < ${cutoffStr}`);
    return Number(result.rowCount ?? 0);
  }

  async insertMarketRiskAssessment(assessment: InsertMarketRiskAssessment): Promise<void> {
    await db.insert(marketRiskAssessments).values(assessment);
  }

  async getMarketRiskAssessments(limit: number = 50): Promise<MarketRiskAssessment[]> {
    return db.select().from(marketRiskAssessments)
      .orderBy(sql`${marketRiskAssessments.calculatedAt} desc`)
      .limit(limit);
  }

  async getLatestRiskByMethod(method: string): Promise<MarketRiskAssessment | undefined> {
    const [row] = await db.select().from(marketRiskAssessments)
      .where(eq(marketRiskAssessments.method, method))
      .orderBy(sql`${marketRiskAssessments.calculatedAt} desc`)
      .limit(1);
    return row;
  }
  async insertBenchmarkRun(run: InsertQuantumBenchmarkRun): Promise<QuantumBenchmarkRun> {
    const [row] = await db.insert(quantumBenchmarkRuns).values(run).returning();
    return row;
  }

  async getBenchmarkRuns(limit: number = 50): Promise<QuantumBenchmarkRun[]> {
    return db.select().from(quantumBenchmarkRuns)
      .orderBy(sql`${quantumBenchmarkRuns.runAt} desc`)
      .limit(limit);
  }

  async getBenchmarkRun(id: string): Promise<QuantumBenchmarkRun | undefined> {
    const [row] = await db.select().from(quantumBenchmarkRuns).where(eq(quantumBenchmarkRuns.id, id));
    return row;
  }

  async deleteBenchmarkRun(id: string): Promise<void> {
    await db.delete(quantumBenchmarkRuns).where(eq(quantumBenchmarkRuns.id, id));
  }

  async insertEnergyLog(log: InsertEnergyLog): Promise<EnergyLog> {
    const [row] = await db.insert(energyLogs).values(log).returning();
    return row;
  }

  async getEnergyLogs(limit: number = 200): Promise<EnergyLog[]> {
    return db.select().from(energyLogs)
      .orderBy(sql`${energyLogs.recordedAt} desc`)
      .limit(limit);
  }

  async getEnergySummary(): Promise<{ totalAiWh: number; totalQuantumWh: number; totalCo2: number; count: number }> {
    const rows = await db.select().from(energyLogs);
    let totalAiWh = 0;
    let totalQuantumWh = 0;
    let totalCo2 = 0;
    for (const r of rows) {
      if (r.processor === "CPU" || r.processor === "GPU") {
        totalAiWh += r.energyWh;
      } else {
        totalQuantumWh += r.energyWh;
      }
      totalCo2 += r.co2Grams;
    }
    return { totalAiWh, totalQuantumWh, totalCo2, count: rows.length };
  }

  async deleteEnergyLog(id: string): Promise<void> {
    await db.delete(energyLogs).where(eq(energyLogs.id, id));
  }

  async clearEnergyLogs(): Promise<void> {
    await db.delete(energyLogs);
  }

  async getUserCredits(userId: string): Promise<number> {
    const [user] = await db.select({ creditBalance: users.creditBalance }).from(users).where(eq(users.id, userId));
    return user?.creditBalance ?? 0;
  }

  async addCredits(userId: string, amount: number, description: string, stripeSessionId?: string): Promise<CreditTransaction | null> {
    if (stripeSessionId) {
      const [existing] = await db.select({ id: creditTransactions.id })
        .from(creditTransactions)
        .where(eq(creditTransactions.stripeSessionId, stripeSessionId))
        .limit(1);
      if (existing) {
        console.log(`[Credits] Duplicate stripeSessionId ${stripeSessionId}, skipping`);
        return null;
      }
    }

    await db.update(users).set({
      creditBalance: sql`${users.creditBalance} + ${amount}`,
    }).where(eq(users.id, userId));

    const [tx] = await db.insert(creditTransactions).values({
      userId,
      amount,
      type: "purchase",
      description,
      stripeSessionId: stripeSessionId || null,
      taskType: null,
    }).returning();
    return tx;
  }

  async deductCredits(userId: string, amount: number, description: string, taskType: string): Promise<CreditTransaction> {
    const [updated] = await db.update(users).set({
      creditBalance: sql`${users.creditBalance} - ${amount}`,
    }).where(and(eq(users.id, userId), sql`${users.creditBalance} >= ${amount}`)).returning({ creditBalance: users.creditBalance });

    if (!updated) {
      const currentBalance = await this.getUserCredits(userId);
      throw new Error(`クレジット不足: 必要${amount}cr / 残高${currentBalance}cr`);
    }

    const [tx] = await db.insert(creditTransactions).values({
      userId,
      amount: -amount,
      type: "usage",
      description,
      stripeSessionId: null,
      taskType,
    }).returning();
    return tx;
  }

  async getCreditTransactions(userId: string, limit: number = 50): Promise<CreditTransaction[]> {
    return await db.select().from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit);
  }

  async updateUserStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void> {
    await db.update(users).set({ stripeCustomerId }).where(eq(users.id, userId));
  }

  async getSetting(key: string): Promise<string | null> {
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return setting?.value ?? null;
  }

  async setSetting(key: string, value: string, label: string, description?: string): Promise<AppSetting> {
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    if (existing) {
      const [updated] = await db.update(appSettings).set({ value, label, description: description ?? existing.description, updatedAt: new Date() }).where(eq(appSettings.key, key)).returning();
      return updated;
    }
    const [created] = await db.insert(appSettings).values({ key, value, label, description: description ?? null }).returning();
    return created;
  }

  async getAllSettings(): Promise<AppSetting[]> {
    return await db.select().from(appSettings).orderBy(appSettings.key);
  }
}

export const storage = new DatabaseStorage();
