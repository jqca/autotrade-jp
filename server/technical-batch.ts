import { fetchHistoricalPrices, type HistoricalPrice } from "./yahoo-finance";
import { storage } from "./storage";
import type { InsertTechnicalIndicator } from "@shared/schema";

export interface IndicatorBatchProgress {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  calculated: number;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string;
}

const progress: IndicatorBatchProgress = {
  status: "idle",
  total: 0,
  processed: 0,
  calculated: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
  message: "",
};

export function getIndicatorBatchProgress(): IndicatorBatchProgress {
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

function computeIndicators(prices: HistoricalPrice[]): InsertTechnicalIndicator | null {
  if (prices.length < 80) return null;
  const closes = prices.map(p => p.close);
  const n = closes.length;

  const ma5Arr = sma(closes, 5);
  const ma25Arr = sma(closes, 25);
  const ma75Arr = sma(closes, 75);
  const ma5 = ma5Arr[n - 1];
  const ma25 = ma25Arr[n - 1];
  const ma75 = ma75Arr[n - 1];
  const prevMa5 = ma5Arr[n - 2];
  const prevMa25 = ma25Arr[n - 2];

  let maTrend: string = "neutral";
  if (ma5 != null && ma25 != null && prevMa5 != null && prevMa25 != null) {
    if (prevMa5 <= prevMa25 && ma5 > ma25) maTrend = "buy";
    else if (prevMa5 >= prevMa25 && ma5 < ma25) maTrend = "sell";
    else if (closes[n - 1] > ma5 && ma5 > ma25) maTrend = "buy";
    else if (closes[n - 1] < ma5 && ma5 < ma25) maTrend = "sell";
  }

  const period20 = 20;
  const mid = sma(closes, period20);
  let bbUpper: number | null = null;
  let bbMiddle: number | null = null;
  let bbLower: number | null = null;
  let bbTrend: string = "neutral";
  if (mid[n - 1] != null) {
    let sumSq = 0;
    for (let j = n - period20; j < n; j++) sumSq += (closes[j] - mid[n - 1]!) ** 2;
    const stdDev = Math.sqrt(sumSq / period20);
    bbUpper = Math.round((mid[n - 1]! + 2 * stdDev) * 10) / 10;
    bbMiddle = Math.round(mid[n - 1]! * 10) / 10;
    bbLower = Math.round((mid[n - 1]! - 2 * stdDev) * 10) / 10;
    if (closes[n - 1] >= bbUpper) bbTrend = "sell";
    else if (closes[n - 1] <= bbLower) bbTrend = "buy";
  }

  let prevAvgGain = 0;
  let prevAvgLoss = 0;
  const rsiPeriod = 14;
  let rsiValue: number | null = null;
  for (let i = 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
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
  let rsiTrend: string = "neutral";
  if (rsiValue != null) {
    if (rsiValue >= 70) rsiTrend = "sell";
    else if (rsiValue <= 30) rsiTrend = "buy";
  }

  const emaFast = ema(closes, 12);
  const emaSlow = ema(closes, 26);
  const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
  const signalLine = ema(macdLine, 9);
  const macdValue = Math.round(macdLine[n - 1] * 100) / 100;
  const macdSignalVal = Math.round(signalLine[n - 1] * 100) / 100;
  const macdHistogram = Math.round((macdLine[n - 1] - signalLine[n - 1]) * 100) / 100;
  const prevMacd = macdLine[n - 2];
  const prevSignal = signalLine[n - 2];

  let macdTrend: string = "neutral";
  if (prevMacd <= prevSignal && macdLine[n - 1] > signalLine[n - 1]) macdTrend = "buy";
  else if (prevMacd >= prevSignal && macdLine[n - 1] < signalLine[n - 1]) macdTrend = "sell";
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

  return {
    ticker: "",
    macdValue,
    macdSignal: macdSignalVal,
    macdHistogram,
    macdTrend,
    rsiValue,
    rsiTrend,
    ma5: ma5 != null ? Math.round(ma5 * 10) / 10 : null,
    ma25: ma25 != null ? Math.round(ma25 * 10) / 10 : null,
    ma75: ma75 != null ? Math.round(ma75 * 10) / 10 : null,
    maTrend,
    bbUpper,
    bbMiddle,
    bbLower,
    bbTrend,
    overallSignal,
    overallLabel,
  };
}

export async function startIndicatorBatch(concurrency: number = 3): Promise<void> {
  if (progress.status === "running") {
    throw new Error("Already running");
  }

  const tickers = await storage.getAllStockTickers();
  const pricedStocks = await storage.getStocksWithPrices();
  const pricedTickers = new Set(pricedStocks.map(s => s.ticker));
  const targetTickers = tickers.filter(t => pricedTickers.has(t));

  progress.status = "running";
  progress.total = targetTickers.length;
  progress.processed = 0;
  progress.calculated = 0;
  progress.errors = 0;
  progress.startedAt = Date.now();
  progress.completedAt = null;
  progress.message = "テクニカル指標の計算を開始しました...";

  console.log(`[Indicators] ${targetTickers.length}銘柄のテクニカル指標を計算します...`);

  (async () => {
    try {
      for (let i = 0; i < targetTickers.length; i += concurrency) {
        const batch = targetTickers.slice(i, i + concurrency);

        await Promise.allSettled(
          batch.map(async (ticker) => {
            try {
              const history = await fetchHistoricalPrices(ticker, "6mo", "1d");
              const result = computeIndicators(history);
              if (result) {
                result.ticker = ticker;
                await storage.upsertTechnicalIndicator(result);
                progress.calculated++;
              }
            } catch {
              progress.errors++;
            }
            progress.processed++;
          })
        );

        progress.message = `${progress.processed}/${progress.total} 処理済み (${progress.calculated}件計算完了)`;

        if (i + concurrency < targetTickers.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      progress.status = "completed";
      progress.completedAt = Date.now();
      const elapsed = Math.round((progress.completedAt - progress.startedAt!) / 1000);
      progress.message = `完了: ${progress.calculated}/${progress.total}件の指標を計算 (${elapsed}秒)`;
      console.log(`[Indicators] ${progress.message}`);
    } catch (err: any) {
      progress.status = "error";
      progress.completedAt = Date.now();
      progress.message = `エラー: ${err.message}`;
      console.error("[Indicators] バッチ処理エラー:", err);
    }
  })();
}
