import { spawn } from "child_process";
import path from "path";
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
  timeframe: string;
  label: string;
  startDate?: string;
  endDate?: string;
  useAi?: boolean;
  useQuantum?: boolean;
  aiThreshold?: number;
}

export const DEFAULT_PARAMS: BacktestParams = {
  targetPercent: 1.0,
  minBuyIndicators: 3,
  rsiMin: 0,
  rsiMax: 30,
  requireMaBuy: false,
  simDays: 200,
  timeframe: "1d",
  label: "",
  useAi: false,
  useQuantum: false,
  aiThreshold: 0.5,
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
  phase?: string;
  aiFiltered?: number;
  quantumSelected?: number;
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

function computeIndicatorsAtIndex(closes: number[], dayIndex: number, minBars: number = 80): DayIndicators | null {
  const slice = closes.slice(0, dayIndex + 1);
  const n = slice.length;
  if (n < minBars) return null;

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

function extractDatePart(datetime: string): string {
  return datetime.split("T")[0];
}

function groupBarsByDay(bars: HistoricalPrice[]): Map<string, HistoricalPrice[]> {
  const dayMap = new Map<string, HistoricalPrice[]>();
  for (const bar of bars) {
    const day = extractDatePart(bar.date);
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day)!.push(bar);
  }
  return dayMap;
}

interface SignalCandidate {
  ticker: string;
  signalDate: string;
  signalLabel: string;
  buyDate: string;
  buyPrice: number;
  dayHigh: number;
  sellDate: string;
  sellPrice: number;
  profitLoss: number;
  profitLossPercent: number;
  isWin: boolean;
  macdTrend: string;
  rsiTrend: string;
  maTrend: string;
  bbTrend: string;
  rsiValue: number | null;
  volatility: number;
  priceChange: number;
  aiScore?: number;
  aiModel?: string;
  ai_passed?: boolean;
  quantumSelected?: boolean;
  quantumMethod?: string;
  varEstimate?: number | null;
}

async function collectDailySignals(params: BacktestParams, tickers: string[], concurrency: number): Promise<SignalCandidate[]> {
  const allSignals: SignalCandidate[] = [];

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
            const indicators = computeIndicatorsAtIndex(closes, d);
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

            const recentCloses = closes.slice(Math.max(0, d - 20), d + 1);
            const volatility = recentCloses.length > 1
              ? Math.sqrt(recentCloses.slice(1).reduce((sum, c, idx) => sum + ((c - recentCloses[idx]) / recentCloses[idx]) ** 2, 0) / (recentCloses.length - 1))
              : 0.02;
            const priceChange = d > 0 ? (closes[d] - closes[d - 1]) / closes[d - 1] : 0;

            allSignals.push({
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
              volatility,
              priceChange,
            });
            progress.signals++;
          }
        } catch {
          progress.errors++;
        }
        progress.processed++;
      })
    );

    progress.message = `Phase1: ${progress.processed}/${progress.total} 処理済み (${progress.signals}件シグナル検出)`;

    if (i + concurrency < tickers.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return allSignals;
}

function aggregateIntradayBars(bars: HistoricalPrice[], minutesPer: number): HistoricalPrice[] {
  if (bars.length === 0 || minutesPer <= 5) return bars;

  const groups = new Map<string, HistoricalPrice[]>();
  for (const bar of bars) {
    const d = new Date(bar.date);
    const totalMinutes = d.getHours() * 60 + d.getMinutes();
    const bucket = Math.floor(totalMinutes / minutesPer) * minutesPer;
    const bucketH = Math.floor(bucket / 60);
    const bucketM = bucket % 60;
    const key = `${bar.date.substring(0, 11)}${String(bucketH).padStart(2, "0")}:${String(bucketM).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(bar);
  }

  const result: HistoricalPrice[] = [];
  for (const [key, group] of groups) {
    result.push({
      date: key,
      open: group[0].open,
      high: Math.max(...group.map(b => b.high)),
      low: Math.min(...group.map(b => b.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, b) => sum + b.volume, 0),
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadIntradayBars(ticker: string, simDays: number, timeframe: string, startDate?: string, endDate?: string): Promise<HistoricalPrice[]> {
  const fromStr = startDate || new Date(Date.now() - (simDays + 10) * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const toStr = endDate ? `${endDate}T23:59` : undefined;

  const dbInterval = timeframe === "10m" ? "10m" : timeframe === "30m" ? "30m" : "5m";
  const stored = await storage.getIntradayPrices(ticker, fromStr, toStr, dbInterval);

  if (stored.length >= 100) {
    return stored.map(b => ({
      date: b.datetime,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
  }

  let bars5m = await fetchHistoricalPrices(ticker, "60d", "5m");
  if (startDate || endDate) {
    bars5m = bars5m.filter(b => {
      const d = b.date.split(/[T ]/)[0];
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
  }
  if (timeframe === "10m") return aggregateIntradayBars(bars5m, 10);
  if (timeframe === "30m") return aggregateIntradayBars(bars5m, 30);
  return bars5m;
}

async function collectIntradaySignals(params: BacktestParams, tickers: string[], concurrency: number): Promise<SignalCandidate[]> {
  const allSignals: SignalCandidate[] = [];

  for (let i = 0; i < tickers.length; i += concurrency) {
    const batch = tickers.slice(i, i + concurrency);

    await Promise.allSettled(
      batch.map(async (ticker) => {
        try {
          const bars = await loadIntradayBars(ticker, params.simDays, params.timeframe, params.startDate, params.endDate);
          if (bars.length < 200) {
            progress.processed++;
            return;
          }

          bars.sort((a, b) => a.date.localeCompare(b.date));

          const dayMap = groupBarsByDay(bars);
          const tradingDays = Array.from(dayMap.keys()).sort();

          const closes = bars.map(b => b.close);

          let barOffset = 0;
          const dayBarOffsets: { day: string; startIdx: number; endIdx: number }[] = [];
          const dayOffsetMap = new Map<string, { startIdx: number; endIdx: number }>();
          for (const day of tradingDays) {
            const dayBars = dayMap.get(day)!;
            const info = { startIdx: barOffset, endIdx: barOffset + dayBars.length - 1 };
            dayBarOffsets.push({ day, ...info });
            dayOffsetMap.set(day, info);
            barOffset += dayBars.length;
          }

          const simDays = Math.min(params.simDays, tradingDays.length);
          const startDayIdx = Math.max(0, tradingDays.length - simDays - 1);

          for (let dayIdx = startDayIdx; dayIdx < tradingDays.length - 1; dayIdx++) {
            const dayInfo = dayBarOffsets[dayIdx];
            const dayBars = dayMap.get(dayInfo.day)!;

            for (let barInDay = 0; barInDay < dayBars.length - 1; barInDay++) {
              const globalIdx = dayInfo.startIdx + barInDay;
              if (globalIdx < 50) continue;

              const indicators = computeIndicatorsAtIndex(closes, globalIdx, 50);
              if (!indicators) continue;

              const buyIndicators = [indicators.macdTrend, indicators.rsiTrend, indicators.maTrend, indicators.bbTrend]
                .filter(t => t === "buy").length;

              if (indicators.overallSignal !== "buy" || buyIndicators < params.minBuyIndicators) continue;
              if (params.requireMaBuy && indicators.maTrend !== "buy") continue;
              if (indicators.rsiValue != null) {
                if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) continue;
              }

              const entryBarGlobal = globalIdx + 1;
              if (entryBarGlobal >= bars.length) continue;

              const entryBar = bars[entryBarGlobal];
              const buyPrice = entryBar.open;
              const entryDay = extractDatePart(entryBar.date);

              const targetMultiplier = 1 + params.targetPercent / 100;
              const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;

              let isWin = false;
              let sellPrice = 0;
              let maxHigh = entryBar.high;
              let sellDate = entryBar.date;

              const entryDayInfo = dayOffsetMap.get(entryDay);
              if (!entryDayInfo) continue;

              for (let k = entryBarGlobal; k <= entryDayInfo.endIdx; k++) {
                if (bars[k].high > maxHigh) maxHigh = bars[k].high;
                if (bars[k].high >= targetPrice) {
                  isWin = true;
                  sellPrice = targetPrice;
                  sellDate = bars[k].date;
                  break;
                }
              }

              if (!isWin) {
                sellPrice = bars[entryDayInfo.endIdx].close;
                sellDate = bars[entryDayInfo.endIdx].date;
              }

              const profitLoss = Math.round((sellPrice - buyPrice) * 100) / 100;
              const profitLossPercent = Math.round((profitLoss / buyPrice) * 10000) / 100;

              const recentCloses = closes.slice(Math.max(0, globalIdx - 20), globalIdx + 1);
              const volatility = recentCloses.length > 1
                ? Math.sqrt(recentCloses.slice(1).reduce((sum, c, idx) => sum + ((c - recentCloses[idx]) / recentCloses[idx]) ** 2, 0) / (recentCloses.length - 1))
                : 0.02;
              const priceChange = globalIdx > 0 ? (closes[globalIdx] - closes[globalIdx - 1]) / closes[globalIdx - 1] : 0;

              allSignals.push({
                ticker,
                signalDate: bars[globalIdx].date,
                signalLabel: indicators.overallLabel,
                buyDate: entryBar.date,
                buyPrice,
                dayHigh: maxHigh,
                sellDate,
                sellPrice,
                profitLoss,
                profitLossPercent,
                isWin,
                macdTrend: indicators.macdTrend,
                rsiTrend: indicators.rsiTrend,
                maTrend: indicators.maTrend,
                bbTrend: indicators.bbTrend,
                rsiValue: indicators.rsiValue,
                volatility,
                priceChange,
              });
              progress.signals++;

              break;
            }
          }
        } catch {
          progress.errors++;
        }
        progress.processed++;
      })
    );

    progress.message = `Phase1: ${progress.processed}/${progress.total} 処理済み (${progress.signals}件シグナル検出)`;

    if (i + concurrency < tickers.length) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  return allSignals;
}

async function runAiQuantumPipeline(signals: SignalCandidate[], params: BacktestParams): Promise<{ processed: SignalCandidate[]; summary: any }> {
  const inputData = {
    signals: signals.map(s => ({
      ticker: s.ticker,
      signalDate: s.signalDate,
      rsiValue: s.rsiValue,
      macdTrend: s.macdTrend,
      maTrend: s.maTrend,
      bbTrend: s.bbTrend,
      volatility: s.volatility,
      priceChange: s.priceChange,
      isWin: s.isWin,
      profitLossPercent: s.profitLossPercent,
    })),
    use_ai: params.useAi ?? true,
    use_quantum: params.useQuantum ?? true,
    ai_threshold: params.aiThreshold ?? 0.5,
    max_per_day: 5,
  };

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "server", "backtest_ai_quantum.py");
    const proc = spawn("python3", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("AI/量子パイプラインがタイムアウトしました（180秒）"));
      }
    }, 180000);

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`AI/量子パイプラインエラー: ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        const processedSignals = result.signals || [];

        const signalMap = new Map<string, any>();
        for (const ps of processedSignals) {
          const key = `${ps.ticker}|${ps.signalDate}`;
          signalMap.set(key, ps);
        }

        for (const s of signals) {
          const key = `${s.ticker}|${s.signalDate}`;
          const ps = signalMap.get(key);
          if (ps) {
            s.aiScore = ps.ai_score ?? undefined;
            s.aiModel = ps.ai_model ?? undefined;
            s.ai_passed = ps.ai_passed ?? true;
            s.quantumSelected = ps.quantum_selected ?? undefined;
            s.quantumMethod = ps.quantum_method ?? undefined;
            s.varEstimate = ps.var_estimate ?? undefined;
          }
        }

        resolve({
          processed: signals,
          summary: {
            ai: result.ai_summary,
            quantum: result.quantum_summary,
            var: result.var_summary,
          },
        });
      } catch {
        reject(new Error(`AI/量子出力パースエラー: ${stdout.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`AI/量子プロセスエラー: ${err.message}`));
    });

    proc.stdin.write(JSON.stringify(inputData));
    proc.stdin.end();
  });
}

async function saveSignals(signals: SignalCandidate[], runId: string, params: BacktestParams): Promise<void> {
  const useAiQuantum = params.useAi || params.useQuantum;

  for (const s of signals) {
    if (useAiQuantum) {
      if (params.useAi && s.ai_passed === false) continue;
      if (params.useQuantum && s.quantumSelected === false) continue;
    }

    const result: InsertBacktestResult = {
      ticker: s.ticker,
      signalDate: s.signalDate,
      signalLabel: s.signalLabel,
      buyDate: s.buyDate,
      buyPrice: s.buyPrice,
      dayHigh: s.dayHigh,
      sellDate: s.sellDate,
      sellPrice: s.sellPrice,
      profitLoss: s.profitLoss,
      profitLossPercent: s.profitLossPercent,
      isWin: s.isWin,
      macdTrend: s.macdTrend,
      rsiTrend: s.rsiTrend,
      maTrend: s.maTrend,
      bbTrend: s.bbTrend,
      rsiValue: s.rsiValue,
      aiScore: s.aiScore ?? null,
      aiModel: s.aiModel ?? null,
      quantumSelected: s.quantumSelected ?? null,
      quantumMethod: s.quantumMethod ?? null,
      varEstimate: s.varEstimate ?? null,
      runId,
    };

    await storage.insertBacktestResult(result);
  }
}

async function runDailyBacktest(params: BacktestParams, runId: string, tickers: string[], concurrency: number): Promise<void> {
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
            const indicators = computeIndicatorsAtIndex(closes, d);
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
}

async function runIntradayBacktest(params: BacktestParams, runId: string, tickers: string[], concurrency: number): Promise<void> {
  for (let i = 0; i < tickers.length; i += concurrency) {
    const batch = tickers.slice(i, i + concurrency);

    await Promise.allSettled(
      batch.map(async (ticker) => {
        try {
          const bars = await loadIntradayBars(ticker, params.simDays, params.timeframe, params.startDate, params.endDate);
          if (bars.length < 200) {
            progress.processed++;
            return;
          }

          bars.sort((a, b) => a.date.localeCompare(b.date));

          const dayMap = groupBarsByDay(bars);
          const tradingDays = Array.from(dayMap.keys()).sort();

          const closes = bars.map(b => b.close);

          let barOffset = 0;
          const dayBarOffsets: { day: string; startIdx: number; endIdx: number }[] = [];
          const dayOffsetMap = new Map<string, { startIdx: number; endIdx: number }>();
          for (const day of tradingDays) {
            const dayBars = dayMap.get(day)!;
            const info = { startIdx: barOffset, endIdx: barOffset + dayBars.length - 1 };
            dayBarOffsets.push({ day, ...info });
            dayOffsetMap.set(day, info);
            barOffset += dayBars.length;
          }

          const simDays = Math.min(params.simDays, tradingDays.length);
          const startDayIdx = Math.max(0, tradingDays.length - simDays - 1);

          for (let dayIdx = startDayIdx; dayIdx < tradingDays.length - 1; dayIdx++) {
            const dayInfo = dayBarOffsets[dayIdx];
            const dayBars = dayMap.get(dayInfo.day)!;

            for (let barInDay = 0; barInDay < dayBars.length - 1; barInDay++) {
              const globalIdx = dayInfo.startIdx + barInDay;
              if (globalIdx < 50) continue;

              const indicators = computeIndicatorsAtIndex(closes, globalIdx, 50);
              if (!indicators) continue;

              const buyIndicators = [indicators.macdTrend, indicators.rsiTrend, indicators.maTrend, indicators.bbTrend]
                .filter(t => t === "buy").length;

              if (indicators.overallSignal !== "buy" || buyIndicators < params.minBuyIndicators) continue;
              if (params.requireMaBuy && indicators.maTrend !== "buy") continue;
              if (indicators.rsiValue != null) {
                if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) continue;
              }

              const entryBarGlobal = globalIdx + 1;
              if (entryBarGlobal >= bars.length) continue;

              const entryBar = bars[entryBarGlobal];
              const buyPrice = entryBar.open;
              const entryDay = extractDatePart(entryBar.date);

              const targetMultiplier = 1 + params.targetPercent / 100;
              const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;

              let isWin = false;
              let sellPrice = 0;
              let maxHigh = entryBar.high;
              let sellDate = entryBar.date;

              const entryDayInfo = dayOffsetMap.get(entryDay);
              if (!entryDayInfo) continue;

              for (let k = entryBarGlobal; k <= entryDayInfo.endIdx; k++) {
                if (bars[k].high > maxHigh) maxHigh = bars[k].high;
                if (bars[k].high >= targetPrice) {
                  isWin = true;
                  sellPrice = targetPrice;
                  sellDate = bars[k].date;
                  break;
                }
              }

              if (!isWin) {
                sellPrice = bars[entryDayInfo.endIdx].close;
                sellDate = bars[entryDayInfo.endIdx].date;
              }

              const profitLoss = Math.round((sellPrice - buyPrice) * 100) / 100;
              const profitLossPercent = Math.round((profitLoss / buyPrice) * 10000) / 100;

              const result: InsertBacktestResult = {
                ticker,
                signalDate: bars[globalIdx].date,
                signalLabel: indicators.overallLabel,
                buyDate: entryBar.date,
                buyPrice,
                dayHigh: maxHigh,
                sellDate,
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

              break;
            }
          }
        } catch {
          progress.errors++;
        }
        progress.processed++;
      })
    );

    progress.message = `${progress.processed}/${progress.total} 処理済み (${progress.signals}件シグナル検出)`;

    if (i + concurrency < tickers.length) {
      await new Promise(r => setTimeout(r, 800));
    }
  }
}

export async function startBacktest(params: BacktestParams = DEFAULT_PARAMS, concurrency: number = 3): Promise<void> {
  if (progress.status === "running") {
    throw new Error("既にバックテストが実行中です");
  }

  const pricedStocks = await storage.getStocksWithPrices();
  const tickers = pricedStocks.map(s => s.ticker);
  const runId = `bt_${Date.now()}`;
  const isIntraday = params.timeframe === "5m" || params.timeframe === "10m" || params.timeframe === "30m";
  const useAiQuantum = params.useAi || params.useQuantum;
  const tfLabels: Record<string, string> = { "5m": "5分足", "10m": "10分足", "30m": "30分足", "1d": "日足" };
  const tfLabel = tfLabels[params.timeframe] || params.timeframe;

  const aiQuantumLabel = useAiQuantum
    ? ` [${params.useAi ? "AI" : ""}${params.useAi && params.useQuantum ? "+" : ""}${params.useQuantum ? "量子" : ""}]`
    : "";

  const runConfig: InsertBacktestRun = {
    runId,
    targetPercent: params.targetPercent,
    minBuyIndicators: params.minBuyIndicators,
    rsiMin: params.rsiMin,
    rsiMax: params.rsiMax,
    requireMaBuy: params.requireMaBuy,
    simDays: params.simDays,
    timeframe: params.timeframe,
    label: params.label || `${tfLabel} 目標${params.targetPercent}% 指標${params.minBuyIndicators}+ RSI${params.rsiMin}-${params.rsiMax}${params.requireMaBuy ? " MA必須" : ""}${aiQuantumLabel}${params.startDate || params.endDate ? ` ${params.startDate || ""}〜${params.endDate || ""}` : ""}`,
    useAi: params.useAi ?? false,
    useQuantum: params.useQuantum ?? false,
    aiThreshold: params.aiThreshold ?? 0.5,
  };
  await storage.insertBacktestRun(runConfig);

  progress.status = "running";
  progress.total = tickers.length;
  progress.processed = 0;
  progress.signals = 0;
  progress.errors = 0;
  progress.startedAt = Date.now();
  progress.completedAt = null;
  progress.message = `${tfLabel}バックテストを開始しました...`;
  progress.runId = runId;
  progress.params = params;
  progress.phase = useAiQuantum ? "scan" : undefined;
  progress.aiFiltered = undefined;
  progress.quantumSelected = undefined;

  console.log(`[Backtest] ${tickers.length}銘柄の${tfLabel}バックテストを開始 (runId: ${runId}, AI: ${params.useAi}, 量子: ${params.useQuantum}, params: ${JSON.stringify(params)})`);

  (async () => {
    try {
      if (useAiQuantum) {
        progress.phase = "scan";
        progress.message = `Phase1: シグナルスキャン中...`;

        let allSignals: SignalCandidate[];
        if (isIntraday) {
          allSignals = await collectIntradaySignals(params, tickers, concurrency);
        } else {
          allSignals = await collectDailySignals(params, tickers, concurrency);
        }

        const totalRawSignals = allSignals.length;

        if (allSignals.length > 0) {
          progress.phase = "ai_quantum";
          progress.message = `Phase2: AI/量子処理中 (${totalRawSignals}件のシグナルを分析)...`;

          try {
            const { processed, summary } = await runAiQuantumPipeline(allSignals, params);
            allSignals = processed;

            const aiPassed = allSignals.filter(s => s.ai_passed !== false).length;
            const quantumSel = allSignals.filter(s => s.quantumSelected !== false).length;
            progress.aiFiltered = totalRawSignals - aiPassed;
            progress.quantumSelected = quantumSel;

            const summaryJson = JSON.stringify(summary);
            try {
              await storage.updateBacktestRunSummary(runId, summaryJson);
            } catch (e) {
              console.error("[Backtest] AI/量子サマリー保存エラー:", e);
            }
          } catch (err: any) {
            console.error("[Backtest] AI/量子パイプラインエラー:", err.message);
            progress.message = `AI/量子処理エラー: ${err.message} — ルールベースで保存します`;
          }
        }

        progress.phase = "save";
        progress.message = `Phase3: 結果保存中...`;
        await saveSignals(allSignals, runId, params);

        const savedCount = allSignals.filter(s => {
          if (params.useAi && s.ai_passed === false) return false;
          if (params.useQuantum && s.quantumSelected === false) return false;
          return true;
        }).length;

        progress.signals = savedCount;
      } else {
        if (isIntraday) {
          await runIntradayBacktest(params, runId, tickers, concurrency);
        } else {
          await runDailyBacktest(params, runId, tickers, concurrency);
        }
      }

      progress.status = "completed";
      progress.completedAt = Date.now();
      progress.phase = undefined;
      const elapsed = Math.round((progress.completedAt - progress.startedAt!) / 1000);
      const aiQuantumInfo = useAiQuantum
        ? ` (AI除外: ${progress.aiFiltered ?? 0}件, 量子選択: ${progress.quantumSelected ?? "-"}件)`
        : "";
      progress.message = `完了: ${progress.processed}銘柄処理, ${progress.signals}件シグナル${aiQuantumInfo} (${elapsed}秒)`;
      console.log(`[Backtest] ${progress.message}`);
    } catch (err: any) {
      progress.status = "error";
      progress.completedAt = Date.now();
      progress.phase = undefined;
      progress.message = `エラー: ${err.message}`;
      console.error("[Backtest] エラー:", err);
    }
  })();
}
