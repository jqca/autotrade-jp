import { storage } from "./storage";
import { computeIndicatorsAtIndex } from "./backtest";
import { kabuFetch, waitForFill } from "./kabuClient";
import { isJpTradingHours } from "./jp-holidays";
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

interface IntradayBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const INTRADAY_MIN_BARS = 50;
const DAILY_MIN_BARS = 50;
const INTRADAY_DAYS_LOOKBACK = 7;
const BAR_INTERVAL_MS = 5 * 60 * 1000;

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

  // 5分足バーをライブモードで蓄積するキャッシュ
  private liveIntradayCache = new Map<string, IntradayBar[]>();
  private liveCacheDate = "";
  // 各銘柄の直近インジケーター計算に使ったバー数（UI表示用）
  private lastBarCounts = new Map<string, { bars: number; source: "intraday_5m" | "daily" }>();

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
    this.addLog("info", `シグナル計算: 5分足リアルタイム（50本以上で自動切替、不足時は日足へフォールバック）`);
    await this.runCycle();
    this.intervalId = setInterval(() => this.runCycle(), this.settings.intervalSeconds * 1000);
  }

  stop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    this.running = false;
    this.liveIntradayCache.clear();
    this.lastBarCounts.clear();
    this.addLog("stop", "自動売買停止");
  }

  private isTradingHours(): boolean {
    return isJpTradingHours(new Date());
  }

  // ライブモードの5分足バーを更新する
  private updateLiveBar(ticker: string, price: number) {
    const now = new Date();
    const jstDateStr = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    // 日付が変わったらキャッシュをリセット
    if (jstDateStr !== this.liveCacheDate) {
      this.liveCacheDate = jstDateStr;
      this.liveIntradayCache.clear();
    }

    // 5分足ウィンドウ（エポックmsを5分単位に丸める）
    const windowStart = Math.floor(now.getTime() / BAR_INTERVAL_MS) * BAR_INTERVAL_MS;
    const bars = this.liveIntradayCache.get(ticker) ?? [];
    const lastBar = bars[bars.length - 1];

    if (lastBar && lastBar.timestamp === windowStart) {
      lastBar.high = Math.max(lastBar.high, price);
      lastBar.low = Math.min(lastBar.low, price);
      lastBar.close = price;
    } else {
      bars.push({ timestamp: windowStart, open: price, high: price, low: price, close: price });
      this.liveIntradayCache.set(ticker, bars);
    }
  }

  // DBから直近N日の5分足データを取得し、ライブキャッシュと結合して終値配列を返す
  private async fetchIntradayCloses(ticker: string): Promise<{ closes: number[]; barCount: number } | null> {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - INTRADAY_DAYS_LOOKBACK);
      const fromStr = fromDate.toISOString().slice(0, 10);

      const dbBars = await storage.getIntradayPrices(ticker, fromStr, undefined, "5m");

      let closes: number[];

      if (this.mode === "live") {
        // ライブモード: DBから昨日以前の分を取得し、今日分はメモリキャッシュで補完
        const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        const historicalCloses = dbBars
          .filter(b => !b.datetime.startsWith(todayJst))
          .map(b => b.close);
        const liveBars = this.liveIntradayCache.get(ticker) ?? [];
        closes = [...historicalCloses, ...liveBars.map(b => b.close)];
      } else {
        // ペーパーモード: DBの5分足データをそのまま使用
        closes = dbBars.map(b => b.close);
      }

      if (closes.length < INTRADAY_MIN_BARS) return null;

      return { closes, barCount: closes.length };
    } catch {
      return null;
    }
  }

  // 日足終値配列を取得（5分足フォールバック用）
  private async fetchDailyCloses(ticker: string): Promise<number[] | null> {
    try {
      const prices = await storage.getIntradayPrices(ticker, undefined, undefined, "1d");
      if (prices.length < DAILY_MIN_BARS) return null;
      return prices.map(p => p.close);
    } catch {
      return null;
    }
  }

  // 現在価格を取得（ライブ: kabu board API / ペーパー: 最新終値）
  private async fetchCurrentPrice(
    ticker: string
  ): Promise<{ currentPrice: number; tickerName: string } | null> {
    if (this.mode === "live") {
      try {
        const board = await kabuFetch("GET", `/board/${ticker}@1`) as any;
        if (board?.CurrentPrice) {
          this.updateLiveBar(ticker, board.CurrentPrice);
          return { currentPrice: board.CurrentPrice, tickerName: board.Symbol ?? ticker };
        }
      } catch (err) {
        this.addLog("error", `${ticker} ボードデータ取得失敗: ${(err as Error).message}`);
      }
      return null;
    } else {
      // ペーパーモード: DBの最新終値
      const daily = await this.fetchDailyCloses(ticker);
      if (!daily || daily.length === 0) return null;
      return { currentPrice: daily[daily.length - 1], tickerName: ticker };
    }
  }

  // シグナル計算用データを取得。5分足を優先し、不足時は日足にフォールバック
  private async fetchPriceData(
    ticker: string
  ): Promise<{ closes: number[]; currentPrice: number; tickerName: string; dataSource: string } | null> {
    try {
      const priceResult = await this.fetchCurrentPrice(ticker);
      if (!priceResult) {
        this.addLog("skip", `${ticker}: 現在価格取得失敗`);
        return null;
      }
      const { currentPrice, tickerName } = priceResult;

      // 5分足データを試みる
      const intradayResult = await this.fetchIntradayCloses(ticker);
      if (intradayResult) {
        const { closes, barCount } = intradayResult;
        // 最新価格を末尾に追加（ライブモードでまだキャッシュに反映されていない場合）
        const lastClose = closes[closes.length - 1];
        if (lastClose !== currentPrice) closes.push(currentPrice);

        this.lastBarCounts.set(ticker, { bars: barCount, source: "intraday_5m" });
        return { closes, currentPrice, tickerName, dataSource: `5分足${barCount}本` };
      }

      // 日足フォールバック
      const dailyCloses = await this.fetchDailyCloses(ticker);
      if (!dailyCloses) {
        this.addLog("skip", `${ticker}: データ不足（5分足・日足ともに50本未満）`);
        return null;
      }

      if (dailyCloses[dailyCloses.length - 1] !== currentPrice) dailyCloses.push(currentPrice);
      this.lastBarCounts.set(ticker, { bars: dailyCloses.length, source: "daily" });
      return { closes: dailyCloses, currentPrice, tickerName, dataSource: `日足${dailyCloses.length}本(フォールバック)` };
    } catch (err) {
      this.addLog("error", `${ticker} データ取得エラー: ${(err as Error).message}`);
      return null;
    }
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

  private async checkBuySignal(ticker: string) {
    const data = await this.fetchPriceData(ticker);
    if (!data) return;
    const { closes, currentPrice, tickerName, dataSource } = data;

    const ind = computeIndicatorsAtIndex(closes, closes.length - 1, INTRADAY_MIN_BARS);
    if (!ind) { this.addLog("skip", `${ticker}: 指標計算不可 [${dataSource}]`); return; }

    const trends = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend];
    const buyCount = trends.filter(t => t === "buy").length;
    const rsiOk = ind.rsiValue == null ||
      (ind.rsiValue >= this.settings.rsiMin && ind.rsiValue <= this.settings.rsiMax);

    if (buyCount >= this.settings.minBuyIndicators && rsiOk) {
      const label = ["MACD", "RSI", "MA", "BB"]
        .filter((_, i) => trends[i] === "buy").join("+");
      this.addLog("buy",
        `🔔 ${ticker}(${tickerName}) 買いシグナル [${label}] RSI=${ind.rsiValue?.toFixed(1) ?? "N/A"} ¥${currentPrice.toLocaleString()} [${dataSource}]`);
      await this.executeBuy(ticker, tickerName, currentPrice, ind);
    } else {
      this.addLog("info",
        `${ticker}(${tickerName}): シグナルなし (買い${buyCount}/4) RSI=${ind.rsiValue?.toFixed(1) ?? "N/A"} ¥${currentPrice.toLocaleString()} [${dataSource}]`);
    }
  }

  private async checkPosition(pos: OpenPosition) {
    const data = await this.fetchPriceData(pos.ticker);
    if (!data) return;
    const { closes, currentPrice, dataSource } = data;
    const pnl = (currentPrice - pos.buyPrice) * pos.qty;

    if (currentPrice <= pos.stopLoss) {
      this.addLog("sell", `🛑 ${pos.ticker} ストップロス ¥${currentPrice.toLocaleString()} 損失¥${Math.round(pnl).toLocaleString()} [${dataSource}]`);
      await this.executeSell(pos, currentPrice, "stop_loss", `ストップロス(${this.settings.stopLossPercent}%下落)`);
      return;
    }
    if (currentPrice >= pos.target) {
      this.addLog("sell", `✅ ${pos.ticker} 目標達成 ¥${currentPrice.toLocaleString()} 利益¥${Math.round(pnl).toLocaleString()} [${dataSource}]`);
      await this.executeSell(pos, currentPrice, "target", `目標達成(${this.settings.targetPercent}%上昇)`);
      return;
    }

    const ind = computeIndicatorsAtIndex(closes, closes.length - 1, INTRADAY_MIN_BARS);
    if (ind) {
      const sellCount = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend].filter(t => t === "sell").length;
      if (sellCount >= 3) {
        this.addLog("sell", `📉 ${pos.ticker} 売りシグナル(${sellCount}/4) ¥${currentPrice.toLocaleString()} P&L¥${Math.round(pnl).toLocaleString()} [${dataSource}]`);
        await this.executeSell(pos, currentPrice, "sell", `売りシグナル(${sellCount}指標)`);
        return;
      }
    }
    this.addLog("info", `${pos.ticker} ホールド ¥${currentPrice.toLocaleString()} 含損益¥${Math.round(pnl).toLocaleString()} [${dataSource}]`);
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
      // ① 発注送信
      let orderId: string;
      try {
        const res = await kabuFetch("POST", "/sendorder", {
          Password: "", Symbol: ticker, Exchange: 1, SecurityType: 1,
          Side: "2", CashMargin: 1, DelivType: 2, AccountType: 4,
          Qty: qty, FrontOrderType: 10, Price: 0, ExpireDay: 0,
        }) as any;
        if (!res?.OrderId) {
          trade.status = "failed";
          trade.errorMsg = JSON.stringify(res);
          this.addLog("error", `${ticker} 発注失敗: ${JSON.stringify(res)}`);
          await storage.insertAutoTrade(trade);
          return;
        }
        orderId = res.OrderId;
      } catch (err) {
        trade.status = "failed";
        trade.errorMsg = (err as Error).message;
        this.addLog("error", `${ticker} 発注エラー: ${(err as Error).message}`);
        await storage.insertAutoTrade(trade);
        return;
      }

      // ② pending_fill でDB保存（受付済み・未確認）
      trade.status = "pending_fill";
      trade.orderId = orderId;
      const saved = await storage.insertAutoTrade(trade);
      this.addLog("info", `${ticker} 発注受付 OrderId=${orderId} 約定確認中... (最大60秒)`);

      // ③ 約定確認ループ
      const fill = await waitForFill(orderId, { timeoutMs: 60_000, pollIntervalMs: 3_000 });

      if (fill.filled || fill.partialFilled) {
        const actualPrice = fill.fillPrice ?? price;
        const actualQty = fill.fillQty > 0 ? fill.fillQty : qty;
        const actualCost = actualPrice * actualQty;
        const stopLoss = actualPrice * (1 - this.settings.stopLossPercent / 100);
        const target = actualPrice * (1 + this.settings.targetPercent / 100);

        await storage.updateAutoTrade(saved.id, {
          status: "executed",
          price: actualPrice,
          qty: actualQty,
          fillPrice: fill.fillPrice ?? undefined,
          fillQty: fill.fillQty > 0 ? fill.fillQty : undefined,
          signalLabel: `${label}${fill.partialFilled ? " [部分約定]" : ""}`,
        });
        this.openPositions.set(ticker, {
          ticker, tickerName, buyPrice: actualPrice, qty: actualQty,
          buyDate: new Date().toISOString(), stopLoss, target, entryId: saved.id,
        });
        this.totalBuys++;
        this.addLog("buy",
          `✅ 約定確認 ${ticker} ${actualQty}株 @¥${actualPrice.toLocaleString()} 合計¥${actualCost.toLocaleString()}${fill.partialFilled ? " [部分約定]" : ""}`);
      } else if (fill.cancelled) {
        await storage.updateAutoTrade(saved.id, {
          status: "cancelled",
          errorMsg: `注文${fill.stateLabel}: OrderId=${orderId}`,
        });
        this.addLog("error", `${ticker} 注文${fill.stateLabel} OrderId=${orderId}`);
      } else {
        // タイムアウト（注文は生きているかもしれない）
        await storage.updateAutoTrade(saved.id, {
          status: "fill_timeout",
          errorMsg: `約定確認タイムアウト(60秒): OrderId=${orderId}`,
        });
        this.addLog("error", `${ticker} 約定確認タイムアウト OrderId=${orderId} — 手動で確認してください`);
      }
      return;
    }

    // ペーパーモード: 即時約定
    this.paperBalance -= totalCost;
    const stopLoss = price * (1 - this.settings.stopLossPercent / 100);
    const target = price * (1 + this.settings.targetPercent / 100);
    const saved = await storage.insertAutoTrade(trade);
    this.openPositions.set(ticker, { ticker, tickerName, buyPrice: price, qty, buyDate: new Date().toISOString(), stopLoss, target, entryId: saved.id });
    this.totalBuys++;
    this.addLog("buy", `買い執行 ${ticker} ${qty}株 @¥${price.toLocaleString()} 合計¥${totalCost.toLocaleString()}`);
    await storage.setSetting("auto_trader_paper_balance", String(this.paperBalance), "ペーパートレード残高");
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
      // ① 発注送信
      let orderId: string;
      try {
        const res = await kabuFetch("POST", "/sendorder", {
          Password: "", Symbol: pos.ticker, Exchange: 1, SecurityType: 1,
          Side: "1", CashMargin: 1, DelivType: 2, AccountType: 4,
          Qty: pos.qty, FrontOrderType: 10, Price: 0, ExpireDay: 0,
        }) as any;
        if (!res?.OrderId) {
          trade.status = "failed"; trade.errorMsg = JSON.stringify(res);
          this.addLog("error", `${pos.ticker} 売り失敗: ${JSON.stringify(res)}`);
          await storage.insertAutoTrade(trade);
          return;
        }
        orderId = res.OrderId;
      } catch (err) {
        trade.status = "failed"; trade.errorMsg = (err as Error).message;
        this.addLog("error", `${pos.ticker} 売りエラー: ${(err as Error).message}`);
        await storage.insertAutoTrade(trade);
        return;
      }

      // ② pending_fill でDB保存
      trade.status = "pending_fill";
      trade.orderId = orderId;
      const saved = await storage.insertAutoTrade(trade);
      this.addLog("info", `${pos.ticker} 売り発注受付 OrderId=${orderId} 約定確認中... (最大60秒)`);

      // ③ ポジションを一旦削除（再エントリー防止）
      this.openPositions.delete(pos.ticker);

      // ④ 約定確認ループ
      const fill = await waitForFill(orderId, { timeoutMs: 60_000, pollIntervalMs: 3_000 });

      if (fill.filled || fill.partialFilled) {
        const actualPrice = fill.fillPrice ?? price;
        const actualQty = fill.fillQty > 0 ? fill.fillQty : pos.qty;
        const actualPnl = (actualPrice - pos.buyPrice) * actualQty;

        await storage.updateAutoTrade(saved.id, {
          status: "executed",
          price: actualPrice,
          qty: actualQty,
          fillPrice: fill.fillPrice ?? undefined,
          fillQty: fill.fillQty > 0 ? fill.fillQty : undefined,
          profitLoss: actualPnl,
          signalLabel: `${reason}${fill.partialFilled ? " [部分約定]" : ""}`,
        });
        this.todayPnl += actualPnl;
        this.totalSells++;
        this.addLog("sell",
          `✅ 売り約定確認 ${pos.ticker} ${actualQty}株 @¥${actualPrice.toLocaleString()} P&L¥${Math.round(actualPnl).toLocaleString()}${fill.partialFilled ? " [部分約定]" : ""}`);

        // 部分約定の場合は残数をポジションとして戻す
        if (fill.partialFilled && fill.fillQty < pos.qty) {
          const remainQty = pos.qty - fill.fillQty;
          this.openPositions.set(pos.ticker, { ...pos, qty: remainQty });
          this.addLog("info", `${pos.ticker} 部分約定: 残${remainQty}株はポジション継続`);
        }
      } else if (fill.cancelled) {
        // 失効・取消: ポジションを戻す
        await storage.updateAutoTrade(saved.id, {
          status: "cancelled",
          errorMsg: `売り注文${fill.stateLabel}: OrderId=${orderId}`,
        });
        this.openPositions.set(pos.ticker, pos);
        this.addLog("error", `${pos.ticker} 売り注文${fill.stateLabel} — ポジション継続 OrderId=${orderId}`);
      } else {
        // タイムアウト: ポジションを戻す
        await storage.updateAutoTrade(saved.id, {
          status: "fill_timeout",
          errorMsg: `売り約定確認タイムアウト(60秒): OrderId=${orderId}`,
        });
        this.openPositions.set(pos.ticker, pos);
        this.addLog("error", `${pos.ticker} 売り約定確認タイムアウト — ポジション継続 手動確認要 OrderId=${orderId}`);
      }
      return;
    }

    // ペーパーモード: 即時約定
    this.paperBalance += proceeds;
    await storage.insertAutoTrade(trade);
    this.openPositions.delete(pos.ticker);
    this.todayPnl += pnl;
    this.totalSells++;
    this.addLog("sell", `売り執行 ${pos.ticker} ${pos.qty}株 @¥${price.toLocaleString()} P&L¥${Math.round(pnl).toLocaleString()}`);
    await storage.setSetting("auto_trader_paper_balance", String(this.paperBalance), "ペーパートレード残高");
  }

  getStatus() {
    const barCounts: Record<string, { bars: number; source: string }> = {};
    for (const [ticker, info] of this.lastBarCounts) {
      barCounts[ticker] = info;
    }
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
      barCounts,
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
    this.liveIntradayCache.clear();
    this.lastBarCounts.clear();
    this.todayPnl = 0;
    this.totalBuys = 0;
    this.totalSells = 0;
    await storage.setSetting("auto_trader_paper_balance", String(amount), "ペーパートレード残高");
    this.addLog("info", `ペーパー残高リセット: ¥${amount.toLocaleString()}`);
  }
}

export const autoTrader = new AutoTrader();
