import { storage } from "./storage";
import { computeIndicatorsAtIndex } from "./backtest";
import { kabuFetch } from "./kabuClient";
import type { InsertAutoTrade } from "@shared/schema";

export interface AutoTraderSettings {
  tickers: string[];
  minBuyIndicators: number;
  rsiMin: number;
  rsiMax: number;
  stopLossPercent: number;
  targetPercent: number;
  maxPositions: number;
  investPerTrade: number;
  maxDailyLossYen: number;
  intervalSeconds: number;
}

export interface OpenPosition {
  ticker: string;
  tickerName: string;
  buyPrice: number;
  qty: number;
  buyDate: string;
  stopLoss: number;
  target: number;
  entryId: string;
}

export interface AutoTraderLogEntry {
  time: string;
  msg: string;
  type: "info" | "buy" | "sell" | "error" | "skip" | "stop";
}

const DEFAULT_SETTINGS: AutoTraderSettings = {
  tickers: ["7203", "6758", "9984", "4755", "8306"],
  minBuyIndicators: 2,
  rsiMin: 40,
  rsiMax: 65,
  stopLossPercent: 2.0,
  targetPercent: 3.0,
  maxPositions: 3,
  investPerTrade: 100000,
  maxDailyLossYen: 50000,
  intervalSeconds: 60,
};

const DEFAULT_PAPER_BALANCE = 1_000_000;

class AutoTrader {
  private running = false;
  private mode: "paper" | "live" = "paper";
  private paperBalance = DEFAULT_PAPER_BALANCE;
  private paperInitialBalance = DEFAULT_PAPER_BALANCE;
  private openPositions = new Map<string, OpenPosition>();
  private todayDate = new Date().toISOString().slice(0, 10);
  private todayPnl = 0;
  private totalBuys = 0;
  private totalSells = 0;
  private log: AutoTraderLogEntry[] = [];
  private lastRunAt: string | null = null;
  private settings: AutoTraderSettings = { ...DEFAULT_SETTINGS };
  private intervalId: NodeJS.Timeout | null = null;

  async init() {
    try {
      const modeVal = await storage.getSetting("auto_trader_mode");
      const paperBalVal = await storage.getSetting("auto_trader_paper_balance");
      const settingsVal = await storage.getSetting("auto_trader_settings");

      if (modeVal === "paper" || modeVal === "live") this.mode = modeVal;
      if (paperBalVal) {
        const parsed = parseFloat(paperBalVal);
        if (!isNaN(parsed)) {
          this.paperBalance = parsed;
          this.paperInitialBalance = parsed;
        }
      }
      if (settingsVal) {
        try { this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settingsVal) }; } catch {}
      }

      await this.restorePositions();
      this.addLog("info", `自動売買エンジン初期化完了。オープンポジション: ${this.openPositions.size}件`);
    } catch (err) {
      this.addLog("error", `初期化エラー: ${(err as Error).message}`);
    }
  }

  private async restorePositions() {
    const recentTrades = await storage.getAutoTrades(500);
    const buyMap = new Map<string, typeof recentTrades[0]>();
    for (const trade of [...recentTrades].reverse()) {
      if (trade.action === "buy" && trade.status === "executed") {
        buyMap.set(trade.ticker, trade);
      } else if (["sell", "stop_loss", "target"].includes(trade.action)) {
        buyMap.delete(trade.ticker);
      }
    }
    for (const [ticker, trade] of buyMap) {
      this.openPositions.set(ticker, {
        ticker,
        tickerName: trade.tickerName ?? ticker,
        buyPrice: trade.price,
        qty: trade.qty,
        buyDate: trade.createdAt?.toISOString() ?? new Date().toISOString(),
        stopLoss: trade.price * (1 - this.settings.stopLossPercent / 100),
        target: trade.price * (1 + this.settings.targetPercent / 100),
        entryId: trade.id,
      });
    }
  }

  private addLog(type: AutoTraderLogEntry["type"], msg: string) {
    const entry: AutoTraderLogEntry = { time: new Date().toISOString(), msg, type };
    this.log.unshift(entry);
    if (this.log.length > 200) this.log.pop();
    console.log(`[AutoTrader][${type.toUpperCase()}] ${msg}`);
  }

  async start(mode?: "paper" | "live") {
    if (this.running) {
      this.addLog("info", "すでに稼働中です");
      return;
    }
    if (mode) this.mode = mode;
    this.running = true;
    this.todayDate = new Date().toISOString().slice(0, 10);
    this.todayPnl = 0;
    await storage.setSetting("auto_trader_mode", this.mode, "自動売買モード");
    this.addLog("info", `自動売買開始 [${this.mode === "paper" ? "ペーパートレード" : "本番取引"}] 監視銘柄: ${this.settings.tickers.join(", ")}`);
    await this.runCycle();
    this.intervalId = setInterval(() => this.runCycle(), this.settings.intervalSeconds * 1000);
  }

  stop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    this.running = false;
    this.addLog("stop", "自動売買停止");
  }

  private isTradingHours(): boolean {
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 3600 * 1000);
    const day = jstNow.getUTCDay();
    const hour = jstNow.getUTCHours();
    const min = jstNow.getUTCMinutes();
    const tod = hour * 60 + min;
    return day >= 1 && day <= 5 && tod >= 9 * 60 && tod <= 15 * 60 + 30;
  }

  private async runCycle() {
    this.lastRunAt = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.todayDate) { this.todayDate = today; this.todayPnl = 0; }

    if (this.todayPnl < -this.settings.maxDailyLossYen) {
      this.addLog("stop", `日次損失上限 ¥${this.settings.maxDailyLossYen.toLocaleString()} 到達。本日取引停止`);
      return;
    }
    if (!this.isTradingHours()) {
      this.addLog("info", "取引時間外 (東証 9:00-15:30 JST)");
      return;
    }

    this.addLog("info", `チェック開始 (${this.settings.tickers.length}銘柄 / ポジション ${this.openPositions.size}/${this.settings.maxPositions})`);

    for (const pos of this.openPositions.values()) {
      await this.checkPosition(pos);
    }
    if (this.openPositions.size < this.settings.maxPositions) {
      for (const ticker of this.settings.tickers) {
        if (this.openPositions.has(ticker)) continue;
        await this.checkBuySignal(ticker);
      }
    }
  }

  private async fetchPriceData(ticker: string): Promise<{ closes: number[]; currentPrice: number; tickerName: string } | null> {
    try {
      let currentPrice: number | null = null;
      let tickerName = ticker;

      if (this.mode === "live") {
        try {
          const board = await kabuFetch("GET", `/board/${ticker}@1`) as any;
          if (board?.CurrentPrice) { currentPrice = board.CurrentPrice; tickerName = board.Symbol ?? ticker; }
        } catch {}
      }

      const prices = await storage.getIntradayPrices(ticker, undefined, undefined, "1d");
      if (prices.length < 50) {
        this.addLog("skip", `${ticker}: データ不足 (${prices.length}本, 50本以上必要)`);
        return null;
      }

      const closes = prices.map(p => p.close);
      if (currentPrice === null) currentPrice = closes[closes.length - 1];
      else closes.push(currentPrice);

      return { closes, currentPrice, tickerName };
    } catch (err) {
      this.addLog("error", `${ticker} データ取得エラー: ${(err as Error).message}`);
      return null;
    }
  }

  private async checkBuySignal(ticker: string) {
    const data = await this.fetchPriceData(ticker);
    if (!data) return;
    const { closes, currentPrice, tickerName } = data;

    const ind = computeIndicatorsAtIndex(closes, closes.length - 1, 50);
    if (!ind) { this.addLog("skip", `${ticker}: 指標計算不可`); return; }

    const trends = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend];
    const buyCount = trends.filter(t => t === "buy").length;
    const rsiOk = ind.rsiValue == null ||
      (ind.rsiValue >= this.settings.rsiMin && ind.rsiValue <= this.settings.rsiMax);

    if (buyCount >= this.settings.minBuyIndicators && rsiOk) {
      const label = ["MACD", "RSI", "MA", "BB"]
        .filter((_, i) => trends[i] === "buy").join("+");
      this.addLog("buy",
        `🔔 ${ticker}(${tickerName}) 買いシグナル [${label}] RSI=${ind.rsiValue?.toFixed(1) ?? "N/A"} ¥${currentPrice.toLocaleString()}`);
      await this.executeBuy(ticker, tickerName, currentPrice, ind);
    } else {
      this.addLog("info",
        `${ticker}(${tickerName}): シグナルなし (買い${buyCount}/4) RSI=${ind.rsiValue?.toFixed(1) ?? "N/A"} ¥${currentPrice.toLocaleString()}`);
    }
  }

  private async checkPosition(pos: OpenPosition) {
    const data = await this.fetchPriceData(pos.ticker);
    if (!data) return;
    const { closes, currentPrice } = data;
    const pnl = (currentPrice - pos.buyPrice) * pos.qty;

    if (currentPrice <= pos.stopLoss) {
      this.addLog("sell", `🛑 ${pos.ticker} ストップロス ¥${currentPrice.toLocaleString()} 損失¥${Math.round(pnl).toLocaleString()}`);
      await this.executeSell(pos, currentPrice, "stop_loss", `ストップロス(${this.settings.stopLossPercent}%下落)`);
      return;
    }
    if (currentPrice >= pos.target) {
      this.addLog("sell", `✅ ${pos.ticker} 目標達成 ¥${currentPrice.toLocaleString()} 利益¥${Math.round(pnl).toLocaleString()}`);
      await this.executeSell(pos, currentPrice, "target", `目標達成(${this.settings.targetPercent}%上昇)`);
      return;
    }

    const ind = computeIndicatorsAtIndex(closes, closes.length - 1, 50);
    if (ind) {
      const sellCount = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend].filter(t => t === "sell").length;
      if (sellCount >= 3) {
        this.addLog("sell", `📉 ${pos.ticker} 売りシグナル(${sellCount}/4) ¥${currentPrice.toLocaleString()} P&L¥${Math.round(pnl).toLocaleString()}`);
        await this.executeSell(pos, currentPrice, "sell", `売りシグナル(${sellCount}指標)`);
        return;
      }
    }
    this.addLog("info", `${pos.ticker} ホールド ¥${currentPrice.toLocaleString()} 含損益¥${Math.round(pnl).toLocaleString()}`);
  }

  private calcQty(price: number): number {
    const raw = Math.floor(this.settings.investPerTrade / price);
    const rounded = Math.floor(raw / 100) * 100;
    return Math.max(rounded, 100);
  }

  private async executeBuy(ticker: string, tickerName: string, price: number,
    ind: ReturnType<typeof computeIndicatorsAtIndex>) {
    const qty = this.calcQty(price);
    const totalCost = price * qty;

    if (this.mode === "paper" && totalCost > this.paperBalance) {
      this.addLog("skip", `${ticker} 残高不足 (必要¥${totalCost.toLocaleString()} / 残高¥${this.paperBalance.toLocaleString()})`);
      return;
    }

    const label = ["MACD", "RSI", "MA", "BB"]
      .filter((_, i) => [ind?.macdTrend, ind?.rsiTrend, ind?.maTrend, ind?.bbTrend][i] === "buy").join("+");
    const stopLoss = price * (1 - this.settings.stopLossPercent / 100);
    const target = price * (1 + this.settings.targetPercent / 100);

    const trade: InsertAutoTrade = {
      mode: this.mode, action: "buy", ticker, tickerName, price, qty,
      capitalBefore: this.mode === "paper" ? this.paperBalance : null,
      capitalAfter: this.mode === "paper" ? this.paperBalance - totalCost : null,
      status: "executed",
      macdTrend: ind?.macdTrend ?? null, rsiTrend: ind?.rsiTrend ?? null,
      maTrend: ind?.maTrend ?? null, bbTrend: ind?.bbTrend ?? null,
      rsiValue: ind?.rsiValue ?? null, signalLabel: label,
    };

    if (this.mode === "live") {
      try {
        const res = await kabuFetch("POST", "/sendorder", {
          Password: "", Symbol: ticker, Exchange: 1, SecurityType: 1,
          Side: "2", CashMargin: 1, DelivType: 2, AccountType: 4,
          Qty: qty, FrontOrderType: 10, Price: 0, ExpireDay: 0,
        }) as any;
        trade.orderId = res?.OrderId ?? null;
        if (!res?.OrderId) {
          trade.status = "failed";
          trade.errorMsg = JSON.stringify(res);
          this.addLog("error", `${ticker} 発注失敗: ${JSON.stringify(res)}`);
          await storage.insertAutoTrade(trade);
          return;
        }
      } catch (err) {
        trade.status = "failed";
        trade.errorMsg = (err as Error).message;
        this.addLog("error", `${ticker} 発注エラー: ${(err as Error).message}`);
        await storage.insertAutoTrade(trade);
        return;
      }
    }

    if (this.mode === "paper") this.paperBalance -= totalCost;
    const saved = await storage.insertAutoTrade(trade);
    this.openPositions.set(ticker, { ticker, tickerName, buyPrice: price, qty, buyDate: new Date().toISOString(), stopLoss, target, entryId: saved.id });
    this.totalBuys++;
    this.addLog("buy", `買い執行 ${ticker} ${qty}株 @¥${price.toLocaleString()} 合計¥${totalCost.toLocaleString()}`);
    if (this.mode === "paper") await storage.setSetting("auto_trader_paper_balance", String(this.paperBalance), "ペーパートレード残高");
  }

  private async executeSell(pos: OpenPosition, price: number, action: "sell" | "stop_loss" | "target", reason: string) {
    const pnl = (price - pos.buyPrice) * pos.qty;
    const proceeds = price * pos.qty;

    const trade: InsertAutoTrade = {
      mode: this.mode, action, ticker: pos.ticker, tickerName: pos.tickerName, price, qty: pos.qty,
      profitLoss: pnl,
      capitalBefore: this.mode === "paper" ? this.paperBalance : null,
      capitalAfter: this.mode === "paper" ? this.paperBalance + proceeds : null,
      status: "executed", signalLabel: reason,
    };

    if (this.mode === "live") {
      try {
        const res = await kabuFetch("POST", "/sendorder", {
          Password: "", Symbol: pos.ticker, Exchange: 1, SecurityType: 1,
          Side: "1", CashMargin: 1, DelivType: 2, AccountType: 4,
          Qty: pos.qty, FrontOrderType: 10, Price: 0, ExpireDay: 0,
        }) as any;
        trade.orderId = res?.OrderId ?? null;
        if (!res?.OrderId) {
          trade.status = "failed"; trade.errorMsg = JSON.stringify(res);
          this.addLog("error", `${pos.ticker} 売り失敗: ${JSON.stringify(res)}`);
          await storage.insertAutoTrade(trade);
          return;
        }
      } catch (err) {
        trade.status = "failed"; trade.errorMsg = (err as Error).message;
        this.addLog("error", `${pos.ticker} 売りエラー: ${(err as Error).message}`);
        await storage.insertAutoTrade(trade);
        return;
      }
    }

    if (this.mode === "paper") this.paperBalance += proceeds;
    await storage.insertAutoTrade(trade);
    this.openPositions.delete(pos.ticker);
    this.todayPnl += pnl;
    this.totalSells++;
    this.addLog("sell", `売り執行 ${pos.ticker} ${pos.qty}株 @¥${price.toLocaleString()} P&L¥${Math.round(pnl).toLocaleString()}`);
    if (this.mode === "paper") await storage.setSetting("auto_trader_paper_balance", String(this.paperBalance), "ペーパートレード残高");
  }

  getStatus() {
    return {
      running: this.running,
      mode: this.mode,
      paperBalance: this.paperBalance,
      paperInitialBalance: this.paperInitialBalance,
      openPositions: Array.from(this.openPositions.values()),
      todayPnl: this.todayPnl,
      totalBuys: this.totalBuys,
      totalSells: this.totalSells,
      log: this.log.slice(0, 50),
      lastRunAt: this.lastRunAt,
      settings: this.settings,
    };
  }

  async updateSettings(patch: Partial<AutoTraderSettings>) {
    this.settings = { ...this.settings, ...patch };
    await storage.setSetting("auto_trader_settings", JSON.stringify(this.settings), "自動売買設定");
    if (this.running && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => this.runCycle(), this.settings.intervalSeconds * 1000);
    }
    return this.settings;
  }

  async resetPaper(amount = DEFAULT_PAPER_BALANCE) {
    this.paperBalance = amount;
    this.paperInitialBalance = amount;
    this.openPositions.clear();
    this.todayPnl = 0;
    this.totalBuys = 0;
    this.totalSells = 0;
    await storage.setSetting("auto_trader_paper_balance", String(amount), "ペーパートレード残高");
    this.addLog("info", `ペーパー残高リセット: ¥${amount.toLocaleString()}`);
  }
}

export const autoTrader = new AutoTrader();
