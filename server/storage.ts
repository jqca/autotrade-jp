import {
  type User, type InsertUser,
  type Stock, type InsertStock,
  type Strategy, type InsertStrategy,
  type Trade, type InsertTrade,
  type PortfolioPosition, type InsertPortfolioPosition,
  users, stocks, strategies, trades, portfolioPositions,
} from "@shared/schema";
import { db } from "./db";
import { eq, sql, like, or, ilike, count } from "drizzle-orm";

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
  bulkUpsertStocks(stockList: InsertStock[]): Promise<number>;
  searchStocks(query: string, limit: number, offset: number): Promise<{ stocks: Stock[]; total: number }>;
  getWatchedStocks(): Promise<Stock[]>;
  getStocksWithPrices(): Promise<Stock[]>;
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
}

export const storage = new DatabaseStorage();
