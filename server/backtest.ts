import { fetchHistoricalPrices, type HistoricalPrice } from "./yahoo-finance";
import { storage } from "./storage";
import type { InsertBacktestResult, InsertBacktestRun } from "@shared/schema";

export interface BacktestParams {
  targetPercent: number;
  minBuyIndicators: number;
  rsiMin: number;
  rsiMax: number;
  requireMaBuy: boolean;
  simDays: number;
  label: string;
}

export const DEFAULT_PARAMS: BacktestParams = {
  targetPercent: 1.0,
  minBuyIndicators: 3,
  rsiMin: 0,
  rsiMax: 30,
  requireMaBuy: false,
  simDays: 200,
  label: "",
};

export interface BacktestProgress {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  signals: number;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string;
  runId: string | null;
  params: BacktestParams | null;
}

const progress: BacktestProgress = {
  status: "idle",
  total: 0,
  processed: 0,
  signals: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
  message: "",
  runId: null,
  params: null,
};

export function getBacktestProgress(): BacktestProgress {
  return { ...progress };
}

function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(sum / period);
    }
  }
  return result;
}

function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = data[0];
  result.push(prev);
  for (let i = 1; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

interface DayIndicators {
  macdTrend: string;
  rsiTrend: string;
  maTrend: string;
  bbTrend: string;
  rsiValue: number | null;
  overallSignal: string;
  overallLabel: string;
}

function computeIndicatorsAtDay(closes: number[], dayIndex: number): DayIndicators | null {
  const slice = closes.slice(0, dayIndex + 1);
  const n = slice.length;
  if (n < 80) return null;

  const ma5Arr = sma(slice, 5);
  const ma25Arr = sma(slice, 25);
  const ma5 = ma5Arr[n - 1];
  const ma25 = ma25Arr[n - 1];
  const prevMa5 = ma5Arr[n - 2];
  const prevMa25 = ma25Arr[n - 2];

  let maTrend = "neutral";
  if (ma5 != null && ma25 != null && prevMa5 != null && prevMa25 != null) {
    if (prevMa5 <= prevMa25 && ma5 > ma25) maTrend = "buy";
    else if (prevMa5 >= prevMa25 && ma5 < ma25) maTrend = "sell";
    else if (slice[n - 1] > ma5 && ma5 > ma25) maTrend = "buy";
    else if (slice[n - 1] < ma5 && ma5 < ma25) maTrend = "sell";
  }

  const period20 = 20;
  const mid = sma(slice, period20);
  let bbTrend = "neutral";
  if (mid[n - 1] != null) {
    let sumSq = 0;
    for (let j = n - period20; j < n; j++) sumSq += (slice[j] - mid[n - 1]!) ** 2;
    const stdDev = Math.sqrt(sumSq / period20);
    const bbUpper = mid[n - 1]! + 2 * stdDev;
    const bbLower = mid[n - 1]! - 2 * stdDev;
    if (slice[n - 1] >= bbUpper) bbTrend = "sell";
    else if (slice[n - 1] <= bbLower) bbTrend = "buy";
  }

  let prevAvgGain = 0;
  let prevAvgLoss = 0;
  const rsiPeriod = 14;
  let rsiValue: number | null = null;
  for (let i = 1; i < n; i++) {
    const diff = slice[i] - slice[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    if (i < rsiPeriod) {
      prevAvgGain += gain;
      prevAvgLoss += loss;
    } else if (i === rsiPeriod) {
      prevAvgGain = (prevAvgGain + gain) / rsiPeriod;
      prevAvgLoss = (prevAvgLoss + loss) / rsiPeriod;
      const rs = prevAvgLoss === 0 ? 100 : prevAvgGain / prevAvgLoss;
      rsiValue = Math.round((100 - 100 / (1 + rs)) * 100) / 100;
    } else {
      prevAvgGain = (prevAvgGain * (rsiPeriod - 1) + gain) / rsiPeriod;
      prevAvgLoss = (prevAvgLoss * (rsiPeriod - 1) + loss) / rsiPeriod;
      const rs = prevAvgLoss === 0 ? 100 : prevAvgGain / prevAvgLoss;
      rsiValue = Math.round((100 - 100 / (1 + rs)) * 100) / 100;
    }
  }
  let rsiTrend = "neutral";
  if (rsiValue != null) {
    if (rsiValue >= 70) rsiTrend = "sell";
    else if (rsiValue <= 30) rsiTrend = "buy";
  }

  const emaFast = ema(slice, 12);
  const emaSlow = ema(slice, 26);
  const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
  const signalLine = ema(macdLine, 9);
  const prevMacd = macdLine[n - 2];
  const prevSignalVal = signalLine[n - 2];

  let macdTrend = "neutral";
  if (prevMacd <= prevSignalVal && macdLine[n - 1] > signalLine[n - 1]) macdTrend = "buy";
  else if (prevMacd >= prevSignalVal && macdLine[n - 1] < signalLine[n - 1]) macdTrend = "sell";
  else if (macdLine[n - 1] > signalLine[n - 1]) macdTrend = "buy";
  else macdTrend = "sell";

  const signals = [macdTrend, rsiTrend, maTrend, bbTrend];
  const buyCount = signals.filter(s => s === "buy").length;
  const sellCount = signals.filter(s => s === "sell").length;
  let overallSignal: string;
  let overallLabel: string;
  if (buyCount >= 3) { overallSignal = "buy"; overallLabel = "強い買いシグナル"; }
  else if (sellCount >= 3) { overallSignal = "sell"; overallLabel = "強い売りシグナル"; }
  else if (buyCount > sellCount) { overallSignal = "buy"; overallLabel = "やや買い優勢"; }
  else if (sellCount > buyCount) { overallSignal = "sell"; overallLabel = "やや売り優勢"; }
  else { overallSignal = "neutral"; overallLabel = "様子見"; }

  return { macdTrend, rsiTrend, maTrend, bbTrend, rsiValue, overallSignal, overallLabel };
}

export async function startBacktest(params: BacktestParams = DEFAULT_PARAMS, concurrency: number = 3): Promise<void> {
  if (progress.status === "running") {
    throw new Error("既にバックテストが実行中です");
  }

  const pricedStocks = await storage.getStocksWithPrices();
  const tickers = pricedStocks.map(s => s.ticker);
  const runId = `bt_${Date.now()}`;

  const runConfig: InsertBacktestRun = {
    runId,
    targetPercent: params.targetPercent,
    minBuyIndicators: params.minBuyIndicators,
    rsiMin: params.rsiMin,
    rsiMax: params.rsiMax,
    requireMaBuy: params.requireMaBuy,
    simDays: params.simDays,
    label: params.label || `目標${params.targetPercent}% 指標${params.minBuyIndicators}+ RSI${params.rsiMin}-${params.rsiMax}${params.requireMaBuy ? " MA必須" : ""}`,
  };
  await storage.insertBacktestRun(runConfig);

  progress.status = "running";
  progress.total = tickers.length;
  progress.processed = 0;
  progress.signals = 0;
  progress.errors = 0;
  progress.startedAt = Date.now();
  progress.completedAt = null;
  progress.message = "バックテストを開始しました...";
  progress.runId = runId;
  progress.params = params;

  console.log(`[Backtest] ${tickers.length}銘柄のバックテストを開始 (runId: ${runId}, params: ${JSON.stringify(params)})`);

  (async () => {
    try {
      for (let i = 0; i < tickers.length; i += concurrency) {
        const batch = tickers.slice(i, i + concurrency);

        await Promise.allSettled(
          batch.map(async (ticker) => {
            try {
              const history = await fetchHistoricalPrices(ticker, "2y", "1d");
              if (history.length < 280) {
                progress.processed++;
                return;
              }

              const closes = history.map(p => p.close);
              const dates = history.map(p => p.date);
              const opens = history.map(p => p.open);
              const highs = history.map(p => p.high);

              const startIdx = Math.max(79, closes.length - params.simDays - 1);

              for (let d = startIdx; d < closes.length - 1; d++) {
                const indicators = computeIndicatorsAtDay(closes, d);
                if (!indicators) continue;

                const buyIndicators = [indicators.macdTrend, indicators.rsiTrend, indicators.maTrend, indicators.bbTrend]
                  .filter(t => t === "buy").length;

                if (indicators.overallSignal !== "buy" || buyIndicators < params.minBuyIndicators) continue;

                if (params.requireMaBuy && indicators.maTrend !== "buy") continue;

                if (indicators.rsiValue != null) {
                  if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) continue;
                }

                const buyDayIdx = d + 1;
                if (buyDayIdx >= closes.length) continue;

                const buyPrice = opens[buyDayIdx];
                const dayHigh = highs[buyDayIdx];
                const targetMultiplier = 1 + params.targetPercent / 100;
                const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;
                const isWin = dayHigh >= targetPrice;
                const sellPrice = isWin ? targetPrice : closes[buyDayIdx];
                const profitLoss = Math.round((sellPrice - buyPrice) * 100) / 100;
                const profitLossPercent = Math.round((profitLoss / buyPrice) * 10000) / 100;

                const result: InsertBacktestResult = {
                  ticker,
                  signalDate: dates[d],
                  signalLabel: indicators.overallLabel,
                  buyDate: dates[buyDayIdx],
                  buyPrice,
                  dayHigh,
                  sellDate: dates[buyDayIdx],
                  sellPrice,
                  profitLoss,
                  profitLossPercent,
                  isWin,
                  macdTrend: indicators.macdTrend,
                  rsiTrend: indicators.rsiTrend,
                  maTrend: indicators.maTrend,
                  bbTrend: indicators.bbTrend,
                  rsiValue: indicators.rsiValue,
                  runId,
                };

                await storage.insertBacktestResult(result);
                progress.signals++;
              }
            } catch {
              progress.errors++;
            }
            progress.processed++;
          })
        );

        progress.message = `${progress.processed}/${progress.total} 処理済み (${progress.signals}件シグナル検出)`;

        if (i + concurrency < tickers.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      progress.status = "completed";
      progress.completedAt = Date.now();
      const elapsed = Math.round((progress.completedAt - progress.startedAt!) / 1000);
      progress.message = `完了: ${progress.processed}銘柄処理, ${progress.signals}件シグナル検出 (${elapsed}秒)`;
      console.log(`[Backtest] ${progress.message}`);
    } catch (err: any) {
      progress.status = "error";
      progress.completedAt = Date.now();
      progress.message = `エラー: ${err.message}`;
      console.error("[Backtest] エラー:", err);
    }
  })();
}
