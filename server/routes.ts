import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertStrategySchema } from "@shared/schema";
import { z } from "zod";
import { fetchHistoricalPrices } from "./yahoo-finance";
import { importJPXStocks, fetchBatchPrices, startFetchAllPrices, getFetchAllProgress } from "./import-stocks";
import { startScheduler, getSchedulerStatus, setSchedulerEnabled } from "./scheduler";
import { startIndicatorBatch, getIndicatorBatchProgress } from "./technical-batch";
import { startBacktest, getBacktestProgress, DEFAULT_PARAMS, type BacktestParams } from "./backtest";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await seedData();

  app.get("/api/stocks", async (req, res) => {
    const query = (req.query.q as string) || "";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = req.query.search as string;

    if (search !== undefined || req.query.q !== undefined) {
      const result = await storage.searchStocks(query, limit, offset);
      res.json(result);
    } else if (req.query.watched !== undefined) {
      const watched = await storage.getWatchedStocks();
      res.json(watched);
    } else {
      const stocks = await storage.getStocksWithPrices();
      res.json(stocks);
    }
  });

  app.patch("/api/stocks/:ticker/watch", async (req, res) => {
    const { ticker } = req.params;
    const schema = z.object({ isWatched: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request body" });
    }
    const stock = await storage.getStockByTicker(ticker);
    if (!stock) {
      return res.status(404).json({ message: "Stock not found" });
    }
    await storage.toggleWatchStock(ticker, parsed.data.isWatched);
    res.json({ success: true });
  });

  app.post("/api/simulate-prices", async (_req, res) => {
    const stocks = await storage.getStocksWithPrices();
    for (const stock of stocks) {
      const changePercent = (Math.random() - 0.5) * 6;
      const newPrice = Math.round(stock.currentPrice * (1 + changePercent / 100));
      const high = Math.max(stock.currentPrice, newPrice);
      const low = Math.min(stock.currentPrice, newPrice);
      const volumeChange = Math.floor(Math.random() * 500000);
      await storage.updateStockPrice(stock.ticker, newPrice, high, low, volumeChange);
      await storage.updatePreviousClose(stock.ticker, stock.currentPrice);

      const position = await storage.getPosition(stock.ticker);
      if (position) {
        await storage.updatePositionPrice(stock.ticker, newPrice);
      }
    }
    res.json({ success: true });
  });

  app.get("/api/strategies", async (_req, res) => {
    const strategies = await storage.getAllStrategies();
    res.json(strategies);
  });

  app.post("/api/strategies", async (req, res) => {
    try {
      const data = insertStrategySchema.parse(req.body);
      const strategy = await storage.createStrategy(data);
      res.json(strategy);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/strategies/:id", async (req, res) => {
    const { id } = req.params;
    const schema = z.object({ isActive: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request body" });
    }
    const existing = await storage.getStrategy(id);
    if (!existing) {
      return res.status(404).json({ message: "Strategy not found" });
    }
    await storage.updateStrategyActive(id, parsed.data.isActive);
    res.json({ success: true });
  });

  app.delete("/api/strategies/:id", async (req, res) => {
    const existing = await storage.getStrategy(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Strategy not found" });
    }
    await storage.deleteStrategy(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/strategies/:id/execute", async (req, res) => {
    const strategy = await storage.getStrategy(req.params.id);
    if (!strategy) {
      return res.status(404).json({ message: "Strategy not found" });
    }
    if (!strategy.isActive) {
      return res.status(400).json({ message: "Strategy is inactive" });
    }

    const stock = await storage.getStockByTicker(strategy.stockTicker);
    if (!stock) {
      return res.status(404).json({ message: "Stock not found" });
    }

    const changePercent = ((stock.currentPrice - stock.previousClose) / stock.previousClose) * 100;

    if (strategy.type === "price_drop_buy" && changePercent <= -strategy.buyCondition) {
      const total = stock.currentPrice * strategy.quantity;
      await storage.createTrade({
        stockTicker: stock.ticker,
        strategyId: strategy.id,
        side: "buy",
        price: stock.currentPrice,
        quantity: strategy.quantity,
        total,
      });
      await storage.upsertPosition(stock.ticker, strategy.quantity, stock.currentPrice, stock.currentPrice);
      return res.json({ success: true, message: "Buy trade executed" });
    }

    if (strategy.type === "price_rise_sell" && changePercent >= strategy.sellCondition) {
      const position = await storage.getPosition(stock.ticker);
      if (!position || position.quantity < strategy.quantity) {
        return res.status(400).json({ message: "Insufficient holdings to sell" });
      }
      const total = stock.currentPrice * strategy.quantity;
      await storage.createTrade({
        stockTicker: stock.ticker,
        strategyId: strategy.id,
        side: "sell",
        price: stock.currentPrice,
        quantity: strategy.quantity,
        total,
      });
      await storage.upsertPosition(stock.ticker, -strategy.quantity, stock.currentPrice, stock.currentPrice);
      return res.json({ success: true, message: "Sell trade executed" });
    }

    if (strategy.type === "threshold_buy" && stock.currentPrice <= strategy.buyCondition) {
      const total = stock.currentPrice * strategy.quantity;
      await storage.createTrade({
        stockTicker: stock.ticker,
        strategyId: strategy.id,
        side: "buy",
        price: stock.currentPrice,
        quantity: strategy.quantity,
        total,
      });
      await storage.upsertPosition(stock.ticker, strategy.quantity, stock.currentPrice, stock.currentPrice);
      return res.json({ success: true, message: "Buy trade executed" });
    }

    if (strategy.type === "threshold_sell" && stock.currentPrice >= strategy.sellCondition) {
      const position = await storage.getPosition(stock.ticker);
      if (!position || position.quantity < strategy.quantity) {
        return res.status(400).json({ message: "Insufficient holdings to sell" });
      }
      const total = stock.currentPrice * strategy.quantity;
      await storage.createTrade({
        stockTicker: stock.ticker,
        strategyId: strategy.id,
        side: "sell",
        price: stock.currentPrice,
        quantity: strategy.quantity,
        total,
      });
      await storage.upsertPosition(stock.ticker, -strategy.quantity, stock.currentPrice, stock.currentPrice);
      return res.json({ success: true, message: "Sell trade executed" });
    }

    res.status(400).json({ message: `Conditions not met. Current change: ${changePercent.toFixed(2)}%, price: ${stock.currentPrice} JPY` });
  });

  app.get("/api/trades", async (_req, res) => {
    const trades = await storage.getAllTrades();
    res.json(trades);
  });

  app.get("/api/portfolio", async (_req, res) => {
    const positions = await storage.getAllPositions();
    res.json(positions);
  });

  app.get("/api/stocks/:ticker/history", async (req, res) => {
    const { ticker } = req.params;
    const range = (req.query.range as string) || "6mo";
    const interval = (req.query.interval as string) || "1d";

    const validRanges = ["1mo", "3mo", "6mo", "1y", "2y", "5y"];
    const validIntervals = ["1d", "1wk", "1mo"];

    if (!validRanges.includes(range)) {
      return res.status(400).json({ message: "Invalid range" });
    }
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({ message: "Invalid interval" });
    }

    try {
      const prices = await fetchHistoricalPrices(ticker, range, interval);
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch historical prices" });
    }
  });

  app.post("/api/import-stocks", async (_req, res) => {
    try {
      const result = await importJPXStocks();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to import stocks" });
    }
  });

  app.post("/api/fetch-prices", async (req, res) => {
    const schema = z.object({
      tickers: z.array(z.string()).max(50),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request. Provide array of tickers (max 50)." });
    }

    try {
      const updated = await fetchBatchPrices(parsed.data.tickers);
      res.json({ updated, total: parsed.data.tickers.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch prices" });
    }
  });

  app.post("/api/fetch-all-prices", async (_req, res) => {
    try {
      await startFetchAllPrices(3, () => {
        console.log("[Manual] 株価取得完了。テクニカル指標の自動計算を開始します...");
        startIndicatorBatch(3).catch((err: any) => {
          console.error("[Manual] テクニカル指標バッチエラー:", err.message);
        });
      });
      res.json({ message: "株価取得を開始しました" });
    } catch (error: any) {
      res.status(409).json({ message: error.message });
    }
  });

  app.get("/api/fetch-all-prices/progress", async (_req, res) => {
    res.json(getFetchAllProgress());
  });

  app.get("/api/scheduler", async (_req, res) => {
    res.json(getSchedulerStatus());
  });

  app.patch("/api/scheduler", async (req, res) => {
    const schema = z.object({ enabled: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request" });
    }
    setSchedulerEnabled(parsed.data.enabled);
    res.json(getSchedulerStatus());
  });

  app.get("/api/indicators/:ticker", async (req, res) => {
    const indicator = await storage.getTechnicalIndicator(req.params.ticker);
    if (!indicator) {
      return res.status(404).json({ message: "テクニカル指標が見つかりません" });
    }
    res.json(indicator);
  });

  app.get("/api/indicators", async (_req, res) => {
    const indicators = await storage.getAllTechnicalIndicators();
    res.json(indicators);
  });

  app.post("/api/indicators/batch", async (_req, res) => {
    try {
      const indicatorProgress = getIndicatorBatchProgress();
      if (indicatorProgress.status === "running") {
        return res.status(409).json({ message: "既に実行中です" });
      }
      await startIndicatorBatch(3);
      res.json({ message: "テクニカル指標の計算を開始しました" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/indicators/batch/progress", async (_req, res) => {
    res.json(getIndicatorBatchProgress());
  });

  app.post("/api/backtest/run", async (req, res) => {
    try {
      const btProgress = getBacktestProgress();
      if (btProgress.status === "running") {
        return res.status(409).json({ message: "既にバックテストが実行中です" });
      }
      const targetPercent = req.body.targetPercent != null ? Number(req.body.targetPercent) : DEFAULT_PARAMS.targetPercent;
      const minBuyIndicators = req.body.minBuyIndicators != null ? Number(req.body.minBuyIndicators) : DEFAULT_PARAMS.minBuyIndicators;
      const rsiMin = req.body.rsiMin != null ? Number(req.body.rsiMin) : DEFAULT_PARAMS.rsiMin;
      const rsiMax = req.body.rsiMax != null ? Number(req.body.rsiMax) : DEFAULT_PARAMS.rsiMax;
      const simDays = req.body.simDays != null ? Number(req.body.simDays) : DEFAULT_PARAMS.simDays;

      if (targetPercent <= 0 || targetPercent > 10) {
        return res.status(400).json({ message: "利確目標は0.1%〜10%の範囲で指定してください" });
      }
      if (minBuyIndicators < 2 || minBuyIndicators > 4) {
        return res.status(400).json({ message: "最低買い指標数は2〜4の範囲で指定してください" });
      }
      if (rsiMin > rsiMax) {
        return res.status(400).json({ message: "RSI下限は上限以下にしてください" });
      }
      if (simDays < 80 || simDays > 400) {
        return res.status(400).json({ message: "シミュレーション日数は80〜400の範囲で指定してください" });
      }

      const params: BacktestParams = {
        targetPercent,
        minBuyIndicators,
        rsiMin,
        rsiMax,
        requireMaBuy: Boolean(req.body.requireMaBuy),
        simDays,
        label: req.body.label || "",
      };
      await startBacktest(params, 3);
      res.json({ message: "バックテストを開始しました", params });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/backtest/progress", async (_req, res) => {
    res.json(getBacktestProgress());
  });

  app.get("/api/backtest/runs", async (_req, res) => {
    const runs = await storage.getBacktestRuns();
    const configs = await storage.getAllBacktestRunConfigs();
    const configMap = new Map(configs.map(c => [c.runId, c]));
    const enriched = runs.map(r => ({
      ...r,
      config: configMap.get(r.runId) || null,
    }));
    res.json(enriched);
  });

  app.get("/api/backtest/results", async (req, res) => {
    const runId = req.query.runId as string | undefined;
    const results = await storage.getBacktestResults(runId);
    res.json(results);
  });

  app.delete("/api/backtest/runs/:runId", async (req, res) => {
    await storage.deleteBacktestRun(req.params.runId);
    res.json({ success: true });
  });

  startScheduler();

  return httpServer;
}

async function seedData() {
  const count = await storage.getStockCount();
  if (count > 0) return;

  const seedStocks = [
    { ticker: "7203", name: "Toyota Motor", sector: "Automotive", currentPrice: 2850, previousClose: 2820, dayHigh: 2870, dayLow: 2800, volume: 12500000, isWatched: true },
    { ticker: "6758", name: "Sony Group", sector: "Electronics", currentPrice: 13200, previousClose: 13050, dayHigh: 13350, dayLow: 13000, volume: 4200000, isWatched: true },
    { ticker: "9984", name: "SoftBank Group", sector: "IT/Telecom", currentPrice: 8950, previousClose: 9100, dayHigh: 9150, dayLow: 8900, volume: 8300000, isWatched: false },
    { ticker: "6861", name: "Keyence", sector: "Electronics", currentPrice: 65800, previousClose: 65200, dayHigh: 66000, dayLow: 64800, volume: 980000, isWatched: true },
    { ticker: "8306", name: "Mitsubishi UFJ Financial", sector: "Finance", currentPrice: 1680, previousClose: 1650, dayHigh: 1700, dayLow: 1640, volume: 25000000, isWatched: false },
    { ticker: "9432", name: "NTT", sector: "IT/Telecom", currentPrice: 175, previousClose: 173, dayHigh: 177, dayLow: 172, volume: 35000000, isWatched: false },
    { ticker: "6501", name: "Hitachi", sector: "Electronics", currentPrice: 3420, previousClose: 3380, dayHigh: 3450, dayLow: 3350, volume: 6800000, isWatched: false },
    { ticker: "7741", name: "HOYA", sector: "Healthcare", currentPrice: 18500, previousClose: 18200, dayHigh: 18600, dayLow: 18100, volume: 1500000, isWatched: false },
    { ticker: "4063", name: "Shin-Etsu Chemical", sector: "Chemicals", currentPrice: 5680, previousClose: 5720, dayHigh: 5750, dayLow: 5650, volume: 3200000, isWatched: false },
    { ticker: "6902", name: "Denso", sector: "Automotive", currentPrice: 2150, previousClose: 2180, dayHigh: 2200, dayLow: 2120, volume: 4500000, isWatched: false },
  ];

  for (const stock of seedStocks) {
    await storage.createStock(stock);
  }

  await storage.createStrategy({
    name: "Toyota Dip Buyer",
    stockTicker: "7203",
    type: "price_drop_buy",
    buyCondition: 2,
    sellCondition: 3,
    quantity: 100,
    isActive: true,
  });

  await storage.createStrategy({
    name: "Sony Profit Taker",
    stockTicker: "6758",
    type: "price_rise_sell",
    buyCondition: 3,
    sellCondition: 2,
    quantity: 50,
    isActive: true,
  });

  await storage.createStrategy({
    name: "Keyence Value Buy",
    stockTicker: "6861",
    type: "threshold_buy",
    buyCondition: 64000,
    sellCondition: 68000,
    quantity: 10,
    isActive: false,
  });

  await storage.upsertPosition("7203", 200, 2800, 2850);
  await storage.upsertPosition("6758", 100, 12800, 13200);
  await storage.upsertPosition("8306", 500, 1620, 1680);

  const tradeData = [
    { stockTicker: "7203", side: "buy", price: 2780, quantity: 100, total: 278000 },
    { stockTicker: "7203", side: "buy", price: 2820, quantity: 100, total: 282000 },
    { stockTicker: "6758", side: "buy", price: 12800, quantity: 100, total: 1280000 },
    { stockTicker: "8306", side: "buy", price: 1620, quantity: 500, total: 810000 },
    { stockTicker: "6758", side: "sell", price: 13100, quantity: 50, total: 655000 },
  ];

  for (const trade of tradeData) {
    await storage.createTrade(trade);
  }
}
