import { spawn } from "child_process";
import path from "path";
import { fetchHistoricalPrices, type HistoricalPrice } from "./yahoo-finance";
import { storage } from "./storage";
import type { InsertBacktestResult, InsertBacktestRun } from "@shared/schema";
import { logEnergy } from "./energy-monitor";

export interface BacktestParams {
  targetPercent: number;
  minBuyIndicators: number;
  requiredIndicators?: string[];
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
  stopLossPercent?: number;
  maxHoldDays?: number;
  minVolume?: number;
  requireUptrend?: boolean;
  dynamicTarget?: boolean;
  requireMacdCrossover?: boolean;
  requireRsiReversal?: boolean;
  requireVolumeSurge?: boolean;
  volumeSurgeRatio?: number;
  maxGapPercent?: number;
  trailingStop?: boolean;
  trailingStopPercent?: number;
  confirmDays?: number;
  minSignalScore?: number;
  requireDailyConfirm?: boolean;
  dailyMinBuyIndicators?: number;
  dailyMinSignalScore?: number;
  initialCapital?: number;
  market?: string;
  rsiExcludeMin?: number;
  rsiExcludeMax?: number;
  minBarVolume?: number;
  minVolatility?: number;
  excludePriceMin?: number;
  excludePriceMax?: number;
  excludeCombos?: string[];
  requireMarketUptrend?: boolean;
  tradingStartHour?: number;
  tradingStartMinute?: number;
  tradingEndHour?: number;
  tradingEndMinute?: number;
  requireNikkeiMomentum?: boolean;
  nikkeiMomentumBars?: number;
  excludeBBSell?: boolean;
  excludeMaBuyAfter?: number;
  rsiExcludeAfterMin?: number;
  rsiExcludeAfterMax?: number;
  rsiExcludeAfterTime?: number;
  minIntradayRange?: number;
  requireEntryConfirm?: boolean;
  entryConfirmBars?: number;
  requireBreakout?: boolean;
  breakoutLookback?: number;
}

const INDICATOR_MAP: Record<string, (ind: ReturnType<typeof computeIndicators>) => boolean> = {
  macd: (ind) => ind.macdTrend === "buy",
  rsi: (ind) => ind.rsiTrend === "buy",
  ma: (ind) => ind.maTrend === "buy",
  bb: (ind) => ind.bbTrend === "buy",
};

function checkRequiredIndicators(indicators: ReturnType<typeof computeIndicators>, params: BacktestParams): boolean {
  if (params.requiredIndicators && params.requiredIndicators.length > 0) {
    for (const key of params.requiredIndicators) {
      const check = INDICATOR_MAP[key];
      if (check && !check(indicators)) return false;
    }
    return true;
  }
  const buyCount = [indicators.macdTrend, indicators.rsiTrend, indicators.maTrend, indicators.bbTrend]
    .filter(t => t === "buy").length;
  return buyCount >= params.minBuyIndicators;
}

export const DEFAULT_PARAMS: BacktestParams = {
  targetPercent: 0.7,
  minBuyIndicators: 2,
  rsiMin: 40,
  rsiMax: 65,
  requireMaBuy: false,
  simDays: 120,
  timeframe: "1d",
  label: "",
  useAi: false,
  useQuantum: false,
  aiThreshold: 0.5,
  stopLossPercent: 0.7,
  maxHoldDays: 1,
  minVolume: 50,
  requireUptrend: false,
  dynamicTarget: false,
  requireMacdCrossover: false,
  requireRsiReversal: false,
  requireVolumeSurge: false,
  volumeSurgeRatio: 1.5,
  maxGapPercent: 2.0,
  trailingStop: false,
  trailingStopPercent: 1.5,
  confirmDays: 1,
  minSignalScore: 0,
  requireDailyConfirm: true,
  dailyMinBuyIndicators: 2,
  dailyMinSignalScore: 0,
  initialCapital: 1000000,
  rsiExcludeMin: 0,
  rsiExcludeMax: 0,
  minBarVolume: 0,
  minVolatility: 0.5,
  excludePriceMin: 0,
  excludePriceMax: 0,
  tradingStartHour: 9,
  tradingStartMinute: 30,
  tradingEndHour: 13,
  tradingEndMinute: 0,
  excludeBBSell: true,
  excludeMaBuyAfter: 600,
  rsiExcludeAfterMin: 45,
  rsiExcludeAfterMax: 50,
  rsiExcludeAfterTime: 600,
  minIntradayRange: 0.5,
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
  skippedByCapital?: number;
  capitalRemaining?: number;
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

let cancelRequested = false;

export function getBacktestProgress(): BacktestProgress {
  return { ...progress };
}

export function cancelBacktest(): boolean {
  if (progress.status !== "running") return false;
  cancelRequested = true;
  progress.message = "キャンセル中...";
  return true;
}

function isCancelled(): boolean {
  return cancelRequested;
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
  isUptrend: boolean;
  bbWidth: number;
  isMacdCrossover: boolean;
  isRsiReversal: boolean;
  prevRsiValue: number | null;
  signalScore: number;
}

export function computeIndicatorsAtIndex(closes: number[], dayIndex: number, minBars: number = 80): DayIndicators | null {
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

  const hist = macdLine.map((m, i) => m - signalLine[i]);
  const histCurr = hist[n - 1];
  const histPrev = hist[n - 2];
  const histPrev2 = n >= 3 ? hist[n - 3] : histPrev;

  const prevMacd = macdLine[n - 2];
  const prevSignalVal = signalLine[n - 2];
  const isMacdCrossover = prevMacd <= prevSignalVal && macdLine[n - 1] > signalLine[n - 1];

  const isHistFlipToPositive = histPrev2 < 0 && histPrev > 0 && histCurr > 0;

  let macdTrend = "neutral";
  if (isHistFlipToPositive || isMacdCrossover) macdTrend = "buy";
  else if (histCurr > 0 && histCurr > histPrev) macdTrend = "buy";
  else if (histCurr > 0) macdTrend = "neutral";
  else macdTrend = "sell";

  let prevRsiValue: number | null = null;
  if (n > rsiPeriod + 2) {
    const prevSlice = slice.slice(0, n - 1);
    let pAvgGain = 0, pAvgLoss = 0;
    for (let i = 1; i < prevSlice.length; i++) {
      const diff = prevSlice[i] - prevSlice[i - 1];
      const g = diff > 0 ? diff : 0;
      const l = diff < 0 ? -diff : 0;
      if (i < rsiPeriod) { pAvgGain += g; pAvgLoss += l; }
      else if (i === rsiPeriod) {
        pAvgGain = (pAvgGain + g) / rsiPeriod;
        pAvgLoss = (pAvgLoss + l) / rsiPeriod;
      } else {
        pAvgGain = (pAvgGain * (rsiPeriod - 1) + g) / rsiPeriod;
        pAvgLoss = (pAvgLoss * (rsiPeriod - 1) + l) / rsiPeriod;
      }
    }
    const pRs = pAvgLoss === 0 ? 100 : pAvgGain / pAvgLoss;
    prevRsiValue = Math.round((100 - 100 / (1 + pRs)) * 100) / 100;
  }

  const isRsiReversal = prevRsiValue != null && rsiValue != null
    && prevRsiValue <= 30 && rsiValue > prevRsiValue && rsiValue <= 50;

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

  let signalScore = 0;
  if (isHistFlipToPositive) signalScore += 30;
  else if (isMacdCrossover) signalScore += 20;
  if (isRsiReversal) signalScore += 25;
  else if (rsiTrend === "buy") signalScore += 10;
  if (maTrend === "buy") signalScore += 25;
  else if (maTrend === "sell") signalScore -= 15;
  if (bbTrend === "buy") signalScore += 15;
  if (prevMa5 != null && prevMa25 != null && prevMa5 <= prevMa25 && ma5 != null && ma25 != null && ma5 > ma25) {
    signalScore += 15;
  }

  const ma5Rising = prevMa5 != null && ma5 != null && ma5 > prevMa5;
  if (maTrend === "sell" && ma5Rising) signalScore += 10;

  const ma75Arr = sma(slice, 75);
  const ma75 = ma75Arr[n - 1];
  const prevMa75 = n >= 3 ? ma75Arr[n - 2] : null;
  const isUptrend = ma25 != null && ma75 != null && prevMa75 != null
    ? (closes[n - 1] > ma25 && ma25 > ma75 && ma75 >= prevMa75)
    : false;

  if (isUptrend) signalScore += 15;

  const bbWidth = mid[n - 1] != null ? (() => {
    let sumSq = 0;
    for (let j = n - 20; j < n; j++) sumSq += (slice[j] - mid[n - 1]!) ** 2;
    const stdDev = Math.sqrt(sumSq / 20);
    return (4 * stdDev) / mid[n - 1]! * 100;
  })() : 4;

  return { macdTrend, rsiTrend, maTrend, bbTrend, rsiValue, overallSignal, overallLabel, isUptrend, bbWidth, isMacdCrossover, isRsiReversal, prevRsiValue, signalScore };
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

type NikkeiMomentumMap = Map<string, number>;

async function buildNikkeiMomentumMap(simDays: number, timeframe: string, startDate?: string, endDate?: string, momentumBars: number = 6): Promise<NikkeiMomentumMap> {
  const map: NikkeiMomentumMap = new Map();
  try {
    const bars = await loadIntradayBars("^N225", simDays, timeframe, startDate, endDate);
    if (bars.length < momentumBars + 1) return map;
    bars.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = momentumBars; i < bars.length; i++) {
      const prev = bars[i - momentumBars].close;
      const curr = bars[i].close;
      if (prev > 0) {
        const momentum = ((curr - prev) / prev) * 100;
        map.set(bars[i].date, momentum);
      }
    }
    console.log(`[Backtest] 日経モメンタムマップ: ${map.size}バー分構築 (${momentumBars}本平均)`);
  } catch (err: any) {
    console.error("[Backtest] 日経平均5分足データ取得失敗:", err.message);
  }
  return map;
}

function checkNikkeiMomentum(barDate: string, nikkeiMap: NikkeiMomentumMap): boolean {
  const momentum = nikkeiMap.get(barDate);
  if (momentum === undefined) {
    const datePrefix = barDate.substring(0, 16);
    for (const [key, val] of nikkeiMap) {
      if (key.startsWith(datePrefix)) {
        return val > 0;
      }
    }
    return true;
  }
  return momentum > 0;
}

interface SignalCandidate {
  ticker: string;
  signalDate: string;
  signalLabel: string;
  buyDate: string;
  buyPrice: number;
  dayHigh: number;
  maxHighDate: string;
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
  capitalBefore?: number;
  capitalAfter?: number;
}

async function collectDailySignals(params: BacktestParams, tickers: string[], concurrency: number): Promise<SignalCandidate[]> {
  const allSignals: SignalCandidate[] = [];

  for (let i = 0; i < tickers.length; i += concurrency) {
    if (isCancelled()) break;
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
          const lows = history.map(p => p.low);
          const volumes = history.map(p => p.volume);

          const startIdx = Math.max(79, closes.length - params.simDays - 1);
          const holdDays = Math.max(1, params.maxHoldDays ?? 1);
          const stopLoss = params.stopLossPercent ?? 0;
          const confirmDays = Math.max(1, params.confirmDays ?? 1);
          const useTrailingStop = params.trailingStop ?? false;
          const trailingStopPct = params.trailingStopPercent ?? 1.5;
          const maxGapPct = params.maxGapPercent ?? 2.0;

          const avgVolume20 = (idx: number): number => {
            const start = Math.max(0, idx - 20);
            let sum = 0;
            for (let j = start; j < idx; j++) sum += volumes[j];
            return sum / Math.max(1, idx - start);
          };

          for (let d = startIdx; d < closes.length - 1; d++) {
            if ((params.minVolume ?? 0) > 0 && Math.floor(volumes[d] / 100) < (params.minVolume ?? 0)) continue;

            const indicators = computeIndicatorsAtIndex(closes, d);
            if (!indicators) continue;

            if (params.requireUptrend && !indicators.isUptrend) continue;

            if (params.requiredIndicators && params.requiredIndicators.length > 0) {
              if (!checkRequiredIndicators(indicators, params)) continue;
            } else {
              if (indicators.overallSignal !== "buy" || !checkRequiredIndicators(indicators, params)) continue;
            }
            if (indicators.overallSignal === "neutral") continue;
            if (params.excludeBBSell && indicators.bbTrend === "sell") continue;
            if (params.requireMaBuy && indicators.maTrend !== "buy") continue;
            if (indicators.rsiValue != null) {
              if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) continue;
              if ((params.rsiExcludeMax ?? 0) > 0 && indicators.rsiValue >= (params.rsiExcludeMin ?? 0) && indicators.rsiValue <= params.rsiExcludeMax!) continue;
            }
            if (params.excludeCombos && params.excludeCombos.length > 0) {
              const combo = `${indicators.rsiTrend}/${indicators.maTrend}/${indicators.bbTrend}`;
              if (params.excludeCombos.includes(combo)) continue;
            }

            if (!(params.requiredIndicators && params.requiredIndicators.length > 0)) {
              if (indicators.maTrend === "sell") {
                if (!indicators.isMacdCrossover && !indicators.isRsiReversal) continue;
              }
            }

            if (params.requireMacdCrossover && !indicators.isMacdCrossover) continue;

            if (params.requireRsiReversal && !indicators.isRsiReversal) continue;

            if (params.requireVolumeSurge) {
              const avgVol = avgVolume20(d);
              const surgeRatio = params.volumeSurgeRatio ?? 1.5;
              if (avgVol > 0 && volumes[d] < avgVol * surgeRatio) continue;
            }

            if ((params.minSignalScore ?? 0) > 0 && indicators.signalScore < (params.minSignalScore ?? 0)) continue;

            if (confirmDays > 1) {
              let confirmed = true;
              for (let cd = 1; cd < confirmDays; cd++) {
                if (d - cd < 0) { confirmed = false; break; }
                const prevInd = computeIndicatorsAtIndex(closes, d - cd);
                if (!prevInd || prevInd.overallSignal !== "buy") { confirmed = false; break; }
              }
              if (!confirmed) continue;
            }

            const buyDayIdx = d + 1;
            if (buyDayIdx >= closes.length) continue;

            const buyDateStr = dates[buyDayIdx];
            const buyDow = new Date(buyDateStr).getDay();
            if (buyDow === 5) continue;

            const buyPrice = opens[buyDayIdx];

            if ((params.excludePriceMax ?? 0) > 0 && buyPrice >= (params.excludePriceMin ?? 0) && buyPrice < (params.excludePriceMax ?? 0)) continue;

            if (buyPrice >= highs[d]) continue;

            if (maxGapPct > 0 && maxGapPct < 100) {
              const gapPercent = Math.abs((buyPrice - closes[d]) / closes[d]) * 100;
              if (gapPercent > maxGapPct) continue;
            }

            const recentCloses = closes.slice(Math.max(0, d - 20), d + 1);
            const volatility = recentCloses.length > 1
              ? Math.sqrt(recentCloses.slice(1).reduce((sum, c, idx) => sum + ((c - recentCloses[idx]) / recentCloses[idx]) ** 2, 0) / (recentCloses.length - 1))
              : 0.02;
            if ((params.minVolatility ?? 0) > 0 && volatility * 100 < (params.minVolatility ?? 0)) continue;

            const recent5 = closes.slice(Math.max(0, d - 4), d + 1);
            if (recent5.length >= 3) {
              let downDays = 0;
              for (let r = 1; r < recent5.length; r++) {
                if (recent5[r] < recent5[r - 1]) downDays++;
              }
              if (downDays >= recent5.length - 1) continue;
            }

            let effectiveTarget = params.targetPercent;
            if (params.dynamicTarget) {
              const volPercent = volatility * 100;
              const minTarget = stopLoss > 0 ? stopLoss * 1.5 : 0.5;
              effectiveTarget = Math.max(minTarget, Math.min(5.0, volPercent * 1.2));
            }

            const targetMultiplier = 1 + effectiveTarget / 100;
            const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;

            const stopPrice = stopLoss > 0
              ? Math.round(buyPrice * (1 - stopLoss / 100) * 100) / 100
              : 0;

            let isWin = false;
            let sellPrice = 0;
            let maxHigh = buyPrice;
            let maxHighDate = dates[buyDayIdx];
            let sellDate = dates[buyDayIdx];
            let trailingStopPrice = 0;

            const endIdx = Math.min(buyDayIdx + holdDays - 1, closes.length - 1);
            for (let k = buyDayIdx; k <= endIdx; k++) {
              if (highs[k] >= targetPrice) {
                isWin = true;
                sellPrice = targetPrice;
                sellDate = dates[k];
                break;
              }

              if (highs[k] > maxHigh) {
                maxHigh = highs[k];
                maxHighDate = dates[k];
                if (useTrailingStop) {
                  trailingStopPrice = Math.round(maxHigh * (1 - trailingStopPct / 100) * 100) / 100;
                }
              }

              if (stopPrice > 0 && lows[k] <= stopPrice) {
                isWin = false;
                sellPrice = stopPrice;
                sellDate = dates[k];
                break;
              }

              if (useTrailingStop && trailingStopPrice > 0 && trailingStopPrice > buyPrice && lows[k] <= trailingStopPrice) {
                sellPrice = trailingStopPrice;
                sellDate = dates[k];
                isWin = true;
                break;
              }

              if (k === endIdx) {
                sellPrice = closes[k];
                sellDate = dates[k];
                isWin = sellPrice > buyPrice;
              }
            }

            if (sellPrice === 0) {
              sellPrice = closes[endIdx];
              sellDate = dates[endIdx];
            }

            const profitLoss = Math.round((sellPrice - buyPrice) * 100) / 100;
            const profitLossPercent = Math.round((profitLoss / buyPrice) * 10000) / 100;
            const priceChange = d > 0 ? (closes[d] - closes[d - 1]) / closes[d - 1] : 0;

            allSignals.push({
              ticker,
              signalDate: dates[d],
              signalLabel: indicators.overallLabel,
              buyDate: dates[buyDayIdx],
              buyPrice,
              dayHigh: maxHigh,
              maxHighDate,
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

interface DailyContext {
  overallSignal: string;
  buyIndicatorCount: number;
  signalScore: number;
  isUptrend: boolean;
  macdTrend: string;
  maTrend: string;
}

async function buildDailyContext(ticker: string): Promise<Map<string, DailyContext>> {
  const dailyMap = new Map<string, DailyContext>();
  try {
    const history = await fetchHistoricalPrices(ticker, "2y", "1d");
    if (history.length < 100) return dailyMap;

    const closes = history.map(p => p.close);
    const dates = history.map(p => p.date);

    for (let d = 79; d < closes.length; d++) {
      const ind = computeIndicatorsAtIndex(closes, d);
      if (!ind) continue;

      const dateKey = dates[d].substring(0, 10);
      const buyCount = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend]
        .filter(t => t === "buy").length;

      dailyMap.set(dateKey, {
        overallSignal: ind.overallSignal,
        buyIndicatorCount: buyCount,
        signalScore: ind.signalScore,
        isUptrend: ind.isUptrend,
        macdTrend: ind.macdTrend,
        maTrend: ind.maTrend,
      });
    }
  } catch {
  }
  return dailyMap;
}

async function collectIntradaySignals(params: BacktestParams, tickers: string[], concurrency: number): Promise<SignalCandidate[]> {
  const allSignals: SignalCandidate[] = [];
  const _gfc: Record<string, number> = {};

  let nikkeiMap: NikkeiMomentumMap | null = null;
  if (params.requireNikkeiMomentum) {
    nikkeiMap = await buildNikkeiMomentumMap(params.simDays, params.timeframe, params.startDate, params.endDate, params.nikkeiMomentumBars ?? 6);
  }

  for (let i = 0; i < tickers.length; i += concurrency) {
    if (isCancelled()) break;
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

          const useDailyConfirm = params.requireDailyConfirm ?? false;
          const macdRequired = params.requiredIndicators?.includes("macd") ?? false;
          const needDailyCtx = useDailyConfirm || macdRequired;
          let dailyCtx: Map<string, DailyContext> | null = null;
          if (needDailyCtx) {
            dailyCtx = await buildDailyContext(ticker);
          }

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

            if (useDailyConfirm && dailyCtx) {
              const dc = dailyCtx.get(dayInfo.day);
              if (!dc) continue;
              const dailyMinBuy = params.dailyMinBuyIndicators ?? 2;
              if (dc.buyIndicatorCount < dailyMinBuy) continue;
              const dailyMinScore = params.dailyMinSignalScore ?? 0;
              if (dailyMinScore > 0 && dc.signalScore < dailyMinScore) continue;
            }

            if (macdRequired && dailyCtx) {
              const prevDayKey = dayIdx > 0 ? dayBarOffsets[dayIdx - 1].day : null;
              const dc = prevDayKey ? dailyCtx.get(prevDayKey) : null;
              if (!dc || (dc.macdTrend !== "buy" && dc.macdTrend !== "neutral")) continue;
            }

            const stopLoss = params.stopLossPercent ?? 0;
            const _fc: Record<string, number> = {};

            for (let barInDay = 0; barInDay < dayBars.length - 1; barInDay++) {
              const globalIdx = dayInfo.startIdx + barInDay;
              if (globalIdx < 50) continue;
              _fc["a_total"] = (_fc["a_total"] ?? 0) + 1;

              let _curBarMin = -1;
              if (params.tradingStartHour != null || params.tradingEndHour != null) {
                const barDate = bars[globalIdx].date;
                const timeMatch = barDate.match(/T(\d{2}):(\d{2})/);
                if (timeMatch) {
                  _curBarMin = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
                  const startMinutes = (params.tradingStartHour ?? 0) * 60 + (params.tradingStartMinute ?? 0);
                  const endMinutes = (params.tradingEndHour ?? 24) * 60 + (params.tradingEndMinute ?? 0);
                  if (_curBarMin < startMinutes) { _fc["b_time"] = (_fc["b_time"] ?? 0) + 1; continue; }
                  if (_curBarMin >= endMinutes) { _fc["b_time"] = (_fc["b_time"] ?? 0) + 1; continue; }
                }
              }
              _fc["c_passTime"] = (_fc["c_passTime"] ?? 0) + 1;

              if (nikkeiMap && nikkeiMap.size > 0 && !checkNikkeiMomentum(bars[globalIdx].date, nikkeiMap)) { _fc["d_nikkei"] = (_fc["d_nikkei"] ?? 0) + 1; continue; }

              if ((params.minVolume ?? 0) > 0 && Math.floor(bars[globalIdx].volume / 100) < (params.minVolume ?? 0)) { _fc["e_vol"] = (_fc["e_vol"] ?? 0) + 1; continue; }
              if ((params.minBarVolume ?? 0) > 0 && Math.floor(bars[globalIdx].volume / 100) < (params.minBarVolume ?? 0)) { _fc["e_barVol"] = (_fc["e_barVol"] ?? 0) + 1; continue; }

              const indicators = computeIndicatorsAtIndex(closes, globalIdx, 50);
              if (!indicators) { _fc["f_noInd"] = (_fc["f_noInd"] ?? 0) + 1; continue; }

              if (params.rsiExcludeAfterTime != null && params.rsiExcludeAfterTime > 0 && _curBarMin >= params.rsiExcludeAfterTime && indicators.rsiValue != null && indicators.rsiValue >= (params.rsiExcludeAfterMin ?? 45) && indicators.rsiValue <= (params.rsiExcludeAfterMax ?? 50)) { _fc["g_rsiAfter"] = (_fc["g_rsiAfter"] ?? 0) + 1; continue; }

              if (params.requireUptrend && !indicators.isUptrend) { _fc["h_uptrend"] = (_fc["h_uptrend"] ?? 0) + 1; continue; }

              if (params.requiredIndicators && params.requiredIndicators.length > 0) {
                if (!checkRequiredIndicators(indicators, params)) { _fc["i_reqInd"] = (_fc["i_reqInd"] ?? 0) + 1; continue; }
              } else {
                if (indicators.overallSignal !== "buy" || !checkRequiredIndicators(indicators, params)) { _fc["i_reqInd"] = (_fc["i_reqInd"] ?? 0) + 1; continue; }
              }
              if (indicators.overallSignal === "neutral") { _fc["j_neutral"] = (_fc["j_neutral"] ?? 0) + 1; continue; }
              if (params.excludeBBSell && indicators.bbTrend === "sell") { _fc["k_bbSell"] = (_fc["k_bbSell"] ?? 0) + 1; continue; }
              if (params.requireMaBuy && indicators.maTrend !== "buy") { _fc["l_maBuy"] = (_fc["l_maBuy"] ?? 0) + 1; continue; }
              if (indicators.rsiValue != null) {
                if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) { _fc["m_rsiRange"] = (_fc["m_rsiRange"] ?? 0) + 1; continue; }
                if ((params.rsiExcludeMax ?? 0) > 0 && indicators.rsiValue >= (params.rsiExcludeMin ?? 0) && indicators.rsiValue <= params.rsiExcludeMax!) { _fc["n_rsiExcl"] = (_fc["n_rsiExcl"] ?? 0) + 1; continue; }
              }

              if (!(params.requiredIndicators && params.requiredIndicators.length > 0)) {
                if (indicators.maTrend === "sell") {
                  if (!indicators.isMacdCrossover && !indicators.isRsiReversal) { _fc["o_maSell"] = (_fc["o_maSell"] ?? 0) + 1; continue; }
                }
              }

              if (params.requireMacdCrossover && !indicators.isMacdCrossover) { _fc["p_macdX"] = (_fc["p_macdX"] ?? 0) + 1; continue; }
              if (params.requireRsiReversal && !indicators.isRsiReversal) { _fc["q_rsiRev"] = (_fc["q_rsiRev"] ?? 0) + 1; continue; }
              if ((params.minSignalScore ?? 0) > 0 && indicators.signalScore < (params.minSignalScore ?? 0)) { _fc["r_score"] = (_fc["r_score"] ?? 0) + 1; continue; }

              if (params.requireVolumeSurge) {
                const surgeRatio = params.volumeSurgeRatio ?? 1.5;
                const lookback = Math.min(20, globalIdx);
                let avgVol = 0;
                for (let vi = globalIdx - lookback; vi < globalIdx; vi++) avgVol += bars[vi].volume;
                avgVol = avgVol / Math.max(1, lookback);
                if (avgVol > 0 && bars[globalIdx].volume < avgVol * surgeRatio) { _fc["s_volSurge"] = (_fc["s_volSurge"] ?? 0) + 1; continue; }
              }
              _fc["t_passSignal"] = (_fc["t_passSignal"] ?? 0) + 1;

              const entryBarGlobal = globalIdx + 1;
              if (entryBarGlobal >= bars.length) continue;

              if (params.requireBreakout) {
                const lookback = params.breakoutLookback ?? 3;
                let recentHigh = -Infinity;
                for (let bi = Math.max(0, globalIdx - lookback); bi <= globalIdx; bi++) {
                  if (bars[bi].high > recentHigh) recentHigh = bars[bi].high;
                }
                if (bars[entryBarGlobal].high < recentHigh) { _fc["u_breakout"] = (_fc["u_breakout"] ?? 0) + 1; continue; }
              }

              const entryBar = bars[entryBarGlobal];
              const buyPrice = entryBar.open;

              if (params.requireEntryConfirm) {
                const confirmBars = params.entryConfirmBars ?? 2;
                let allBelow = true;
                for (let ci = 1; ci <= confirmBars; ci++) {
                  const checkIdx = entryBarGlobal + ci;
                  if (checkIdx >= bars.length) { allBelow = false; break; }
                  if (bars[checkIdx].close > buyPrice) { allBelow = false; break; }
                }
                if (allBelow) { _fc["v_entryConf"] = (_fc["v_entryConf"] ?? 0) + 1; continue; }
              }

              if ((params.excludePriceMax ?? 0) > 0 && buyPrice >= (params.excludePriceMin ?? 0) && buyPrice < (params.excludePriceMax ?? 0)) { _fc["w_price"] = (_fc["w_price"] ?? 0) + 1; continue; }

              const maxGapPctVal = params.maxGapPercent ?? 2.0;
              if (maxGapPctVal > 0 && maxGapPctVal < 100) {
                const gapPct = Math.abs((buyPrice - closes[globalIdx]) / closes[globalIdx]) * 100;
                if (gapPct > maxGapPctVal) { _fc["x_gap"] = (_fc["x_gap"] ?? 0) + 1; continue; }
              }

              const confirmDaysVal = Math.max(1, params.confirmDays ?? 1);
              if (confirmDaysVal > 1) {
                let confirmed = true;
                for (let cd = 1; cd < confirmDaysVal; cd++) {
                  const prevIdx = globalIdx - cd;
                  if (prevIdx < 0) { confirmed = false; break; }
                  const prevInd = computeIndicatorsAtIndex(closes, prevIdx, 50);
                  if (!prevInd || prevInd.overallSignal !== "buy") { confirmed = false; break; }
                }
                if (!confirmed) { _fc["y_confDay"] = (_fc["y_confDay"] ?? 0) + 1; continue; }
              }

              const entryDay = extractDatePart(entryBar.date);

              const recentCloses = closes.slice(Math.max(0, globalIdx - 20), globalIdx + 1);
              const volatility = recentCloses.length > 1
                ? Math.sqrt(recentCloses.slice(1).reduce((sum, c, idx) => sum + ((c - recentCloses[idx]) / recentCloses[idx]) ** 2, 0) / (recentCloses.length - 1))
                : 0.02;
              if ((params.minVolatility ?? 0) > 0 && volatility * 100 < (params.minVolatility ?? 0)) { _fc["z1_vol"] = (_fc["z1_vol"] ?? 0) + 1; continue; }
              if ((params.minIntradayRange ?? 0) > 0) {
                const rangeLen = Math.min(10, globalIdx - (dayInfo?.startIdx ?? 0) + 1);
                if (rangeLen > 0) {
                  let rangeHigh = -Infinity, rangeLow = Infinity;
                  for (let ri = globalIdx; ri > globalIdx - rangeLen; ri--) {
                    if (bars[ri].high > rangeHigh) rangeHigh = bars[ri].high;
                    if (bars[ri].low < rangeLow) rangeLow = bars[ri].low;
                  }
                  const rangePct = rangeLow > 0 ? ((rangeHigh - rangeLow) / rangeLow) * 100 : 0;
                  if (rangePct < (params.minIntradayRange ?? 0)) { _fc["z2_range"] = (_fc["z2_range"] ?? 0) + 1; continue; }
                }
              }

              let effectiveTarget = params.targetPercent;
              if (params.dynamicTarget) {
                const volPercent = volatility * 100;
                effectiveTarget = Math.max(0.2, Math.min(2.0, volPercent * 0.6));
              }

              const targetMultiplier = 1 + effectiveTarget / 100;
              const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;

              const stopPrice = stopLoss > 0
                ? Math.round(buyPrice * (1 - stopLoss / 100) * 100) / 100
                : 0;

              let isWin = false;
              let sellPrice = 0;
              let maxHigh = entryBar.high;
              let maxHighDate = entryBar.date;
              let sellDate = entryBar.date;
              const useTrailingStop = params.trailingStop ?? false;
              const trailingStopPct = params.trailingStopPercent ?? 1.5;
              let trailingStopPrice = 0;

              const entryDayInfo = dayOffsetMap.get(entryDay);
              if (!entryDayInfo) continue;

              const maxHoldBars = params.timeframe === "5m" ? 3 : params.timeframe === "15m" ? 1 : 999;
              const holdLimit = Math.min(entryBarGlobal + maxHoldBars, entryDayInfo.endIdx);
              for (let k = entryBarGlobal; k <= holdLimit; k++) {
                if (bars[k].high > maxHigh) {
                  maxHigh = bars[k].high;
                  maxHighDate = bars[k].date;
                  if (useTrailingStop) {
                    trailingStopPrice = Math.round(maxHigh * (1 - trailingStopPct / 100) * 100) / 100;
                  }
                }

                if (stopPrice > 0 && bars[k].low <= stopPrice) {
                  isWin = false;
                  sellPrice = stopPrice;
                  sellDate = bars[k].date;
                  break;
                }

                if (useTrailingStop && trailingStopPrice > 0 && bars[k].low <= trailingStopPrice) {
                  sellPrice = trailingStopPrice;
                  sellDate = bars[k].date;
                  isWin = sellPrice > buyPrice;
                  break;
                }

                if (bars[k].high >= targetPrice) {
                  isWin = true;
                  sellPrice = targetPrice;
                  sellDate = bars[k].date;
                  break;
                }
              }

              if (sellPrice === 0) {
                const exitIdx = Math.min(holdLimit, entryDayInfo.endIdx);
                sellPrice = bars[exitIdx].close;
                sellDate = bars[exitIdx].date;
                isWin = sellPrice > buyPrice;
              }

              const profitLoss = Math.round((sellPrice - buyPrice) * 100) / 100;
              const profitLossPercent = Math.round((profitLoss / buyPrice) * 10000) / 100;
              const priceChange = globalIdx > 0 ? (closes[globalIdx] - closes[globalIdx - 1]) / closes[globalIdx - 1] : 0;

              allSignals.push({
                ticker,
                signalDate: bars[globalIdx].date,
                signalLabel: indicators.overallLabel,
                buyDate: entryBar.date,
                buyPrice,
                dayHigh: maxHigh,
                maxHighDate,
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
          for (const [k, v] of Object.entries(_fc)) { _gfc[k] = (_gfc[k] ?? 0) + v; }
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

  console.log("[Backtest] フィルター統計:", JSON.stringify(_gfc, null, 2));
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

        const aiTimeMs = result.ai_summary?.time_ms || 5000;
        const qTimeMs = result.quantum_summary?.time_ms || 3000;
        const varTimeMs = result.var_summary?.time_ms || 2000;
        logEnergy("backtest", "AIシグナルスコアリング (GBM)", "CPU", aiTimeMs, 0.8, { model: "GradientBoosting", signals: signals.length }).catch(() => {});
        if (params.useQuantum) {
          logEnergy("backtest", "量子ポートフォリオ選択 (QAOA)", "QPU+CRYO", qTimeMs, 0.7, { method: "QAOA" }).catch(() => {});
          logEnergy("backtest", "量子VaR推定 (振幅推定)", "QPU+CRYO", varTimeMs, 0.7, { method: "AmplitudeEstimation" }).catch(() => {});
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

const UNIT_SHARES_JP = 100;
const UNIT_SHARES_US = 1;

function simulateCapital(signals: SignalCandidate[], initialCapital: number, market?: string): { executed: SignalCandidate[]; skipped: number; finalCapital: number } {
  const unitShares = market === "US" ? UNIT_SHARES_US : UNIT_SHARES_JP;
  if (initialCapital <= 0) {
    for (const s of signals) {
      s.capitalBefore = undefined;
      s.capitalAfter = undefined;
    }
    return { executed: signals, skipped: 0, finalCapital: 0 };
  }

  signals.sort((a, b) => a.buyDate.localeCompare(b.buyDate));

  let cash = initialCapital;
  const openPositions: { ticker: string; buyDate: string; sellDate: string; buyCost: number; sellProceeds: number }[] = [];
  const executed: SignalCandidate[] = [];
  let skipped = 0;

  for (const signal of signals) {
    const closedBefore: number[] = [];
    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      if (pos.sellDate <= signal.buyDate) {
        cash += pos.sellProceeds;
        closedBefore.push(i);
      }
    }
    for (const idx of closedBefore.sort((a, b) => b - a)) {
      openPositions.splice(idx, 1);
    }

    const buyCost = Math.round(signal.buyPrice * unitShares);
    if (cash < buyCost) {
      skipped++;
      continue;
    }

    signal.capitalBefore = Math.round(cash);
    cash -= buyCost;

    const sellProceeds = Math.round(signal.sellPrice * unitShares);
    openPositions.push({
      ticker: signal.ticker,
      buyDate: signal.buyDate,
      sellDate: signal.sellDate,
      buyCost,
      sellProceeds,
    });

    signal.capitalAfter = Math.round(cash + openPositions.reduce((sum, p) => sum + p.sellProceeds, 0));
    executed.push(signal);
  }

  for (const pos of openPositions) {
    cash += pos.sellProceeds;
  }

  return { executed, skipped, finalCapital: Math.round(cash) };
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
      maxHighDate: s.maxHighDate,
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
      capitalBefore: s.capitalBefore ?? null,
      capitalAfter: s.capitalAfter ?? null,
      runId,
    };

    await storage.insertBacktestResult(result);
  }
}

async function collectDailySignalsDirect(params: BacktestParams, tickers: string[], concurrency: number): Promise<SignalCandidate[]> {
  const allSignals: SignalCandidate[] = [];
  const useTrailingStop = params.trailingStop ?? false;
  const trailingStopPct = params.trailingStopPercent ?? 1.5;

  for (let i = 0; i < tickers.length; i += concurrency) {
    if (isCancelled()) break;
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
          const lows = history.map(p => p.low);
          const volumes = history.map(p => p.volume);

          const startIdx = Math.max(79, closes.length - params.simDays - 1);
          const holdDays = Math.max(1, params.maxHoldDays ?? 1);
          const stopLoss = params.stopLossPercent ?? 0;

          for (let d = startIdx; d < closes.length - 1; d++) {
            if ((params.minVolume ?? 0) > 0 && Math.floor(volumes[d] / 100) < (params.minVolume ?? 0)) continue;

            const indicators = computeIndicatorsAtIndex(closes, d);
            if (!indicators) continue;

            if (params.requireUptrend && !indicators.isUptrend) continue;

            if (params.requiredIndicators && params.requiredIndicators.length > 0) {
              if (!checkRequiredIndicators(indicators, params)) continue;
            } else {
              if (indicators.overallSignal !== "buy" || !checkRequiredIndicators(indicators, params)) continue;
            }
            if (indicators.overallSignal === "neutral") continue;
            if (params.excludeBBSell && indicators.bbTrend === "sell") continue;
            if (params.requireMaBuy && indicators.maTrend !== "buy") continue;
            if (indicators.rsiValue != null) {
              if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) continue;
              if ((params.rsiExcludeMax ?? 0) > 0 && indicators.rsiValue >= (params.rsiExcludeMin ?? 0) && indicators.rsiValue <= params.rsiExcludeMax!) continue;
            }
            if (params.excludeCombos && params.excludeCombos.length > 0) {
              const combo = `${indicators.rsiTrend}/${indicators.maTrend}/${indicators.bbTrend}`;
              if (params.excludeCombos.includes(combo)) continue;
            }

            const buyDayIdx = d + 1;
            if (buyDayIdx >= closes.length) continue;

            const buyDateStr2 = dates[buyDayIdx];
            const buyDow2 = new Date(buyDateStr2).getDay();
            if (buyDow2 === 5) continue;

            const buyPrice = opens[buyDayIdx];

            if ((params.excludePriceMax ?? 0) > 0 && buyPrice >= (params.excludePriceMin ?? 0) && buyPrice < (params.excludePriceMax ?? 0)) continue;

            if (buyPrice >= highs[d]) continue;

            const recentCloses = closes.slice(Math.max(0, d - 20), d + 1);
            const volatility = recentCloses.length > 1
              ? Math.sqrt(recentCloses.slice(1).reduce((sum, c, idx) => sum + ((c - recentCloses[idx]) / recentCloses[idx]) ** 2, 0) / (recentCloses.length - 1))
              : 0.02;
            if ((params.minVolatility ?? 0) > 0 && volatility * 100 < (params.minVolatility ?? 0)) continue;

            const recent5 = closes.slice(Math.max(0, d - 4), d + 1);
            if (recent5.length >= 3) {
              let downDays = 0;
              for (let r = 1; r < recent5.length; r++) {
                if (recent5[r] < recent5[r - 1]) downDays++;
              }
              if (downDays >= recent5.length - 1) continue;
            }

            let effectiveTarget = params.targetPercent;
            if (params.dynamicTarget) {
              const volPercent = volatility * 100;
              const minTarget = stopLoss > 0 ? stopLoss * 1.5 : 0.5;
              effectiveTarget = Math.max(minTarget, Math.min(5.0, volPercent * 1.2));
            }

            const targetMultiplier = 1 + effectiveTarget / 100;
            const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;
            const stopPrice = stopLoss > 0 ? Math.round(buyPrice * (1 - stopLoss / 100) * 100) / 100 : 0;

            let isWin = false;
            let sellPrice = 0;
            let maxHigh = buyPrice;
            let maxHighDate = dates[buyDayIdx];
            let sellDate = dates[buyDayIdx];
            let trailingStopPrice2 = 0;

            const endIdx = Math.min(buyDayIdx + holdDays - 1, closes.length - 1);
            for (let k = buyDayIdx; k <= endIdx; k++) {
              if (highs[k] >= targetPrice) { isWin = true; sellPrice = targetPrice; sellDate = dates[k]; break; }
              if (highs[k] > maxHigh) {
                maxHigh = highs[k];
                maxHighDate = dates[k];
                if (useTrailingStop) {
                  trailingStopPrice2 = Math.round(maxHigh * (1 - trailingStopPct / 100) * 100) / 100;
                }
              }
              if (stopPrice > 0 && lows[k] <= stopPrice) { isWin = false; sellPrice = stopPrice; sellDate = dates[k]; break; }
              if (useTrailingStop && trailingStopPrice2 > 0 && trailingStopPrice2 > buyPrice && lows[k] <= trailingStopPrice2) { sellPrice = trailingStopPrice2; sellDate = dates[k]; isWin = true; break; }
              if (k === endIdx) { sellPrice = closes[k]; sellDate = dates[k]; isWin = sellPrice > buyPrice; }
            }
            if (sellPrice === 0) { sellPrice = closes[endIdx]; sellDate = dates[endIdx]; }

            const profitLoss = Math.round((sellPrice - buyPrice) * 100) / 100;
            const profitLossPercent = Math.round((profitLoss / buyPrice) * 10000) / 100;

            allSignals.push({
              ticker,
              signalDate: dates[d],
              signalLabel: indicators.overallLabel,
              buyDate: dates[buyDayIdx],
              buyPrice,
              dayHigh: maxHigh,
              maxHighDate,
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
              priceChange: d > 0 ? (closes[d] - closes[d - 1]) / closes[d - 1] : 0,
            });
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

  return allSignals;
}

async function collectIntradaySignalsDirect(params: BacktestParams, tickers: string[], concurrency: number): Promise<SignalCandidate[]> {
  const allSignals: SignalCandidate[] = [];

  let nikkeiMap: NikkeiMomentumMap | null = null;
  if (params.requireNikkeiMomentum) {
    nikkeiMap = await buildNikkeiMomentumMap(params.simDays, params.timeframe, params.startDate, params.endDate, params.nikkeiMomentumBars ?? 6);
  }

  for (let i = 0; i < tickers.length; i += concurrency) {
    if (isCancelled()) break;
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

          const useDailyConfirm2 = params.requireDailyConfirm ?? false;
          const macdRequired2 = params.requiredIndicators?.includes("macd") ?? false;
          const needDailyCtx2 = useDailyConfirm2 || macdRequired2;
          let dailyCtx2: Map<string, DailyContext> | null = null;
          if (needDailyCtx2) {
            dailyCtx2 = await buildDailyContext(ticker);
          }

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

            if (useDailyConfirm2 && dailyCtx2) {
              const dc = dailyCtx2.get(dayInfo.day);
              if (!dc) continue;
              const dailyMinBuy = params.dailyMinBuyIndicators ?? 2;
              if (dc.buyIndicatorCount < dailyMinBuy) continue;
              const dailyMinScore = params.dailyMinSignalScore ?? 0;
              if (dailyMinScore > 0 && dc.signalScore < dailyMinScore) continue;
            }

            if (macdRequired2 && dailyCtx2) {
              const prevDayKey = dayIdx > 0 ? dayBarOffsets[dayIdx - 1].day : null;
              const dc = prevDayKey ? dailyCtx2.get(prevDayKey) : null;
              if (!dc || (dc.macdTrend !== "buy" && dc.macdTrend !== "neutral")) continue;
            }


            const stopLoss = params.stopLossPercent ?? 0;

            for (let barInDay = 0; barInDay < dayBars.length - 1; barInDay++) {
              const globalIdx = dayInfo.startIdx + barInDay;
              if (globalIdx < 50) continue;

              let _curBarMin = -1;
              if (params.tradingStartHour != null || params.tradingEndHour != null) {
                const barDate = bars[globalIdx].date;
                const timeMatch = barDate.match(/T(\d{2}):(\d{2})/);
                if (timeMatch) {
                  _curBarMin = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
                  const startMinutes = (params.tradingStartHour ?? 0) * 60 + (params.tradingStartMinute ?? 0);
                  const endMinutes = (params.tradingEndHour ?? 24) * 60 + (params.tradingEndMinute ?? 0);
                  if (_curBarMin < startMinutes) continue;
                  if (_curBarMin >= endMinutes) continue;
                }
              }

              if (nikkeiMap && nikkeiMap.size > 0 && !checkNikkeiMomentum(bars[globalIdx].date, nikkeiMap)) continue;

              if ((params.minVolume ?? 0) > 0 && Math.floor(bars[globalIdx].volume / 100) < (params.minVolume ?? 0)) continue;
              if ((params.minBarVolume ?? 0) > 0 && Math.floor(bars[globalIdx].volume / 100) < (params.minBarVolume ?? 0)) continue;

              const indicators = computeIndicatorsAtIndex(closes, globalIdx, 50);
              if (!indicators) continue;

              if (params.rsiExcludeAfterTime != null && params.rsiExcludeAfterTime > 0 && _curBarMin >= params.rsiExcludeAfterTime && indicators.rsiValue != null && indicators.rsiValue >= (params.rsiExcludeAfterMin ?? 45) && indicators.rsiValue <= (params.rsiExcludeAfterMax ?? 50)) continue;

              if (params.requireUptrend && !indicators.isUptrend) continue;

              if (params.requiredIndicators && params.requiredIndicators.length > 0) {
                if (!checkRequiredIndicators(indicators, params)) continue;
              } else {
                if (indicators.overallSignal !== "buy" || !checkRequiredIndicators(indicators, params)) continue;
              }
              if (indicators.overallSignal === "neutral") continue;
              if (params.excludeBBSell && indicators.bbTrend === "sell") continue;
              if (params.requireMaBuy && indicators.maTrend !== "buy") continue;
              if (indicators.rsiValue != null) {
                if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) continue;
                if ((params.rsiExcludeMax ?? 0) > 0 && indicators.rsiValue >= (params.rsiExcludeMin ?? 0) && indicators.rsiValue <= params.rsiExcludeMax!) continue;
              }

              if (!(params.requiredIndicators && params.requiredIndicators.length > 0)) {
                if (indicators.maTrend === "sell") {
                  if (!indicators.isMacdCrossover && !indicators.isRsiReversal) continue;
                }
              }

              if (params.requireMacdCrossover && !indicators.isMacdCrossover) continue;
              if (params.requireRsiReversal && !indicators.isRsiReversal) continue;
              if ((params.minSignalScore ?? 0) > 0 && indicators.signalScore < (params.minSignalScore ?? 0)) continue;

              if (params.requireVolumeSurge) {
                const surgeRatio = params.volumeSurgeRatio ?? 1.5;
                const lookback = Math.min(20, globalIdx);
                let avgVol = 0;
                for (let vi = globalIdx - lookback; vi < globalIdx; vi++) avgVol += bars[vi].volume;
                avgVol = avgVol / Math.max(1, lookback);
                if (avgVol > 0 && bars[globalIdx].volume < avgVol * surgeRatio) continue;
              }

              const entryBarGlobal = globalIdx + 1;
              if (entryBarGlobal >= bars.length) continue;

              if (params.requireBreakout) {
                const lookback = params.breakoutLookback ?? 3;
                let recentHigh = -Infinity;
                for (let bi = Math.max(0, globalIdx - lookback); bi <= globalIdx; bi++) {
                  if (bars[bi].high > recentHigh) recentHigh = bars[bi].high;
                }
                if (bars[entryBarGlobal].high < recentHigh) continue;
              }

              const entryBar = bars[entryBarGlobal];
              const buyPrice = entryBar.open;

              if (params.requireEntryConfirm) {
                const confirmBars = params.entryConfirmBars ?? 2;
                let allBelow = true;
                for (let ci = 1; ci <= confirmBars; ci++) {
                  const checkIdx = entryBarGlobal + ci;
                  if (checkIdx >= bars.length) { allBelow = false; break; }
                  if (bars[checkIdx].close > buyPrice) { allBelow = false; break; }
                }
                if (allBelow) continue;
              }

              if ((params.excludePriceMax ?? 0) > 0 && buyPrice >= (params.excludePriceMin ?? 0) && buyPrice < (params.excludePriceMax ?? 0)) continue;

              const maxGapPctVal2 = params.maxGapPercent ?? 2.0;
              if (maxGapPctVal2 > 0 && maxGapPctVal2 < 100) {
                const gapPct = Math.abs((buyPrice - closes[globalIdx]) / closes[globalIdx]) * 100;
                if (gapPct > maxGapPctVal2) continue;
              }

              const confirmDaysVal2 = Math.max(1, params.confirmDays ?? 1);
              if (confirmDaysVal2 > 1) {
                let confirmed = true;
                for (let cd = 1; cd < confirmDaysVal2; cd++) {
                  const prevIdx = globalIdx - cd;
                  if (prevIdx < 0) { confirmed = false; break; }
                  const prevInd = computeIndicatorsAtIndex(closes, prevIdx, 50);
                  if (!prevInd || prevInd.overallSignal !== "buy") { confirmed = false; break; }
                }
                if (!confirmed) continue;
              }

              const entryDay = extractDatePart(entryBar.date);

              const recentCloses = closes.slice(Math.max(0, globalIdx - 20), globalIdx + 1);
              const volatility = recentCloses.length > 1
                ? Math.sqrt(recentCloses.slice(1).reduce((sum, c, idx) => sum + ((c - recentCloses[idx]) / recentCloses[idx]) ** 2, 0) / (recentCloses.length - 1))
                : 0.02;
              if ((params.minVolatility ?? 0) > 0 && volatility * 100 < (params.minVolatility ?? 0)) continue;
              if ((params.minIntradayRange ?? 0) > 0) {
                const rangeLen = Math.min(10, globalIdx - (dayInfo?.startIdx ?? 0) + 1);
                if (rangeLen > 0) {
                  let rangeHigh = -Infinity, rangeLow = Infinity;
                  for (let ri = globalIdx; ri > globalIdx - rangeLen; ri--) {
                    if (bars[ri].high > rangeHigh) rangeHigh = bars[ri].high;
                    if (bars[ri].low < rangeLow) rangeLow = bars[ri].low;
                  }
                  const rangePct = rangeLow > 0 ? ((rangeHigh - rangeLow) / rangeLow) * 100 : 0;
                  if (rangePct < (params.minIntradayRange ?? 0)) continue;
                }
              }

              let effectiveTarget = params.targetPercent;
              if (params.dynamicTarget) {
                const volPercent = volatility * 100;
                const minTarget = stopLoss > 0 ? stopLoss * 1.5 : 0.3;
                effectiveTarget = Math.max(minTarget, Math.min(3.0, volPercent * 0.8));
              }

              const targetMultiplier = 1 + effectiveTarget / 100;
              const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;
              const stopPrice = stopLoss > 0 ? Math.round(buyPrice * (1 - stopLoss / 100) * 100) / 100 : 0;

              let isWin = false;
              let sellPrice = 0;
              let maxHigh = entryBar.high;
              let sellDate = entryBar.date;
              const useTrailingStop2 = params.trailingStop ?? false;
              const trailingStopPct2 = params.trailingStopPercent ?? 1.5;
              let trailingStopPrice2 = 0;

              const entryDayInfo = dayOffsetMap.get(entryDay);
              if (!entryDayInfo) continue;

              const maxHoldBars = params.timeframe === "5m" ? 3 : params.timeframe === "15m" ? 1 : 999;
              const holdLimit = Math.min(entryBarGlobal + maxHoldBars, entryDayInfo.endIdx);
              for (let k = entryBarGlobal; k <= holdLimit; k++) {
                if (bars[k].high >= targetPrice) { isWin = true; sellPrice = targetPrice; sellDate = bars[k].date; break; }
                if (bars[k].high > maxHigh) {
                  maxHigh = bars[k].high;
                  if (useTrailingStop2) {
                    trailingStopPrice2 = Math.round(maxHigh * (1 - trailingStopPct2 / 100) * 100) / 100;
                  }
                }
                if (stopPrice > 0 && bars[k].low <= stopPrice) { isWin = false; sellPrice = stopPrice; sellDate = bars[k].date; break; }
                if (useTrailingStop2 && trailingStopPrice2 > 0 && trailingStopPrice2 > buyPrice && bars[k].low <= trailingStopPrice2) { sellPrice = trailingStopPrice2; sellDate = bars[k].date; isWin = true; break; }
              }

              if (sellPrice === 0) {
                const exitIdx = Math.min(holdLimit, entryDayInfo.endIdx);
                sellPrice = bars[exitIdx].close;
                sellDate = bars[exitIdx].date;
                isWin = sellPrice > buyPrice;
              }

              const profitLoss = Math.round((sellPrice - buyPrice) * 100) / 100;
              const profitLossPercent = Math.round((profitLoss / buyPrice) * 10000) / 100;

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
                priceChange: globalIdx > 0 ? (closes[globalIdx] - closes[globalIdx - 1]) / closes[globalIdx - 1] : 0,
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

    progress.message = `${progress.processed}/${progress.total} 処理済み (${progress.signals}件シグナル検出)`;

    if (i + concurrency < tickers.length) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  return allSignals;
}

async function _unused_runDailyBacktest(params: BacktestParams, runId: string, tickers: string[], concurrency: number): Promise<void> {
  for (let i = 0; i < tickers.length; i += concurrency) {
    if (isCancelled()) break;
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
          const lows = history.map(p => p.low);
          const volumes = history.map(p => p.volume);

          const startIdx = Math.max(79, closes.length - params.simDays - 1);
          const holdDays = Math.max(1, params.maxHoldDays ?? 1);
          const stopLoss = params.stopLossPercent ?? 0;

          for (let d = startIdx; d < closes.length - 1; d++) {
            if ((params.minVolume ?? 0) > 0 && Math.floor(volumes[d] / 100) < (params.minVolume ?? 0)) continue;

            const indicators = computeIndicatorsAtIndex(closes, d);
            if (!indicators) continue;

            if (params.requireUptrend && !indicators.isUptrend) continue;

            if (params.requiredIndicators && params.requiredIndicators.length > 0) {
              if (!checkRequiredIndicators(indicators, params)) continue;
            } else {
              if (indicators.overallSignal !== "buy" || !checkRequiredIndicators(indicators, params)) continue;
            }
            if (indicators.overallSignal === "neutral") continue;
            if (params.excludeBBSell && indicators.bbTrend === "sell") continue;
            if (params.requireMaBuy && indicators.maTrend !== "buy") continue;
            if (indicators.rsiValue != null) {
              if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) continue;
              if ((params.rsiExcludeMax ?? 0) > 0 && indicators.rsiValue >= (params.rsiExcludeMin ?? 0) && indicators.rsiValue <= params.rsiExcludeMax!) continue;
            }
            if (params.excludeCombos && params.excludeCombos.length > 0) {
              const combo = `${indicators.rsiTrend}/${indicators.maTrend}/${indicators.bbTrend}`;
              if (params.excludeCombos.includes(combo)) continue;
            }

            const buyDayIdx = d + 1;
            if (buyDayIdx >= closes.length) continue;

            const buyDateStr2 = dates[buyDayIdx];
            const buyDow2 = new Date(buyDateStr2).getDay();
            if (buyDow2 === 5) continue;

            const buyPrice = opens[buyDayIdx];

            if ((params.excludePriceMax ?? 0) > 0 && buyPrice >= (params.excludePriceMin ?? 0) && buyPrice < (params.excludePriceMax ?? 0)) continue;

            if (buyPrice >= highs[d]) continue;

            const recentCloses = closes.slice(Math.max(0, d - 20), d + 1);
            const volatility = recentCloses.length > 1
              ? Math.sqrt(recentCloses.slice(1).reduce((sum, c, idx) => sum + ((c - recentCloses[idx]) / recentCloses[idx]) ** 2, 0) / (recentCloses.length - 1))
              : 0.02;
            if ((params.minVolatility ?? 0) > 0 && volatility * 100 < (params.minVolatility ?? 0)) continue;

            const recent5 = closes.slice(Math.max(0, d - 4), d + 1);
            if (recent5.length >= 3) {
              let downDays = 0;
              for (let r = 1; r < recent5.length; r++) {
                if (recent5[r] < recent5[r - 1]) downDays++;
              }
              if (downDays >= recent5.length - 1) continue;
            }

            let effectiveTarget = params.targetPercent;
            if (params.dynamicTarget) {
              const volPercent = volatility * 100;
              const minTarget = stopLoss > 0 ? stopLoss * 1.5 : 0.5;
              effectiveTarget = Math.max(minTarget, Math.min(5.0, volPercent * 1.2));
            }

            const targetMultiplier = 1 + effectiveTarget / 100;
            const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;
            const stopPrice = stopLoss > 0 ? Math.round(buyPrice * (1 - stopLoss / 100) * 100) / 100 : 0;

            let isWin = false;
            let sellPrice = 0;
            let maxHigh = buyPrice;
            let sellDate = dates[buyDayIdx];
            let trailingStopPrice2 = 0;

            const endIdx = Math.min(buyDayIdx + holdDays - 1, closes.length - 1);
            for (let k = buyDayIdx; k <= endIdx; k++) {
              if (highs[k] >= targetPrice) { isWin = true; sellPrice = targetPrice; sellDate = dates[k]; break; }
              if (highs[k] > maxHigh) {
                maxHigh = highs[k];
                if (useTrailingStop) {
                  trailingStopPrice2 = Math.round(maxHigh * (1 - trailingStopPct / 100) * 100) / 100;
                }
              }
              if (stopPrice > 0 && lows[k] <= stopPrice) { isWin = false; sellPrice = stopPrice; sellDate = dates[k]; break; }
              if (useTrailingStop && trailingStopPrice2 > 0 && trailingStopPrice2 > buyPrice && lows[k] <= trailingStopPrice2) { sellPrice = trailingStopPrice2; sellDate = dates[k]; isWin = true; break; }
              if (k === endIdx) { sellPrice = closes[k]; sellDate = dates[k]; isWin = sellPrice > buyPrice; }
            }
            if (sellPrice === 0) { sellPrice = closes[endIdx]; sellDate = dates[endIdx]; }

            const profitLoss = Math.round((sellPrice - buyPrice) * 100) / 100;
            const profitLossPercent = Math.round((profitLoss / buyPrice) * 10000) / 100;

            const result: InsertBacktestResult = {
              ticker,
              signalDate: dates[d],
              signalLabel: indicators.overallLabel,
              buyDate: dates[buyDayIdx],
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
  let nikkeiMap: NikkeiMomentumMap | null = null;
  if (params.requireNikkeiMomentum) {
    nikkeiMap = await buildNikkeiMomentumMap(params.simDays, params.timeframe, params.startDate, params.endDate, params.nikkeiMomentumBars ?? 6);
  }

  for (let i = 0; i < tickers.length; i += concurrency) {
    if (isCancelled()) break;
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

          const useDailyConfirm2 = params.requireDailyConfirm ?? false;
          const macdRequired2 = params.requiredIndicators?.includes("macd") ?? false;
          const needDailyCtx2 = useDailyConfirm2 || macdRequired2;
          let dailyCtx2: Map<string, DailyContext> | null = null;
          if (needDailyCtx2) {
            dailyCtx2 = await buildDailyContext(ticker);
          }

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

            if (useDailyConfirm2 && dailyCtx2) {
              const dc = dailyCtx2.get(dayInfo.day);
              if (!dc) continue;
              const dailyMinBuy = params.dailyMinBuyIndicators ?? 2;
              if (dc.buyIndicatorCount < dailyMinBuy) continue;
              const dailyMinScore = params.dailyMinSignalScore ?? 0;
              if (dailyMinScore > 0 && dc.signalScore < dailyMinScore) continue;
            }

            if (macdRequired2 && dailyCtx2) {
              const prevDayKey = dayIdx > 0 ? dayBarOffsets[dayIdx - 1].day : null;
              const dc = prevDayKey ? dailyCtx2.get(prevDayKey) : null;
              if (!dc || (dc.macdTrend !== "buy" && dc.macdTrend !== "neutral")) continue;
            }


            const stopLoss = params.stopLossPercent ?? 0;

            for (let barInDay = 0; barInDay < dayBars.length - 1; barInDay++) {
              const globalIdx = dayInfo.startIdx + barInDay;
              if (globalIdx < 50) continue;

              let _curBarMin = -1;
              if (params.tradingStartHour != null || params.tradingEndHour != null) {
                const barDate = bars[globalIdx].date;
                const timeMatch = barDate.match(/T(\d{2}):(\d{2})/);
                if (timeMatch) {
                  _curBarMin = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
                  const startMinutes = (params.tradingStartHour ?? 0) * 60 + (params.tradingStartMinute ?? 0);
                  const endMinutes = (params.tradingEndHour ?? 24) * 60 + (params.tradingEndMinute ?? 0);
                  if (_curBarMin < startMinutes) continue;
                  if (_curBarMin >= endMinutes) continue;
                }
              }

              if (nikkeiMap && nikkeiMap.size > 0 && !checkNikkeiMomentum(bars[globalIdx].date, nikkeiMap)) continue;

              if ((params.minVolume ?? 0) > 0 && Math.floor(bars[globalIdx].volume / 100) < (params.minVolume ?? 0)) continue;
              if ((params.minBarVolume ?? 0) > 0 && Math.floor(bars[globalIdx].volume / 100) < (params.minBarVolume ?? 0)) continue;

              const indicators = computeIndicatorsAtIndex(closes, globalIdx, 50);
              if (!indicators) continue;

              if (params.rsiExcludeAfterTime != null && params.rsiExcludeAfterTime > 0 && _curBarMin >= params.rsiExcludeAfterTime && indicators.rsiValue != null && indicators.rsiValue >= (params.rsiExcludeAfterMin ?? 45) && indicators.rsiValue <= (params.rsiExcludeAfterMax ?? 50)) continue;

              if (params.requireUptrend && !indicators.isUptrend) continue;

              if (params.requiredIndicators && params.requiredIndicators.length > 0) {
                if (!checkRequiredIndicators(indicators, params)) continue;
              } else {
                if (indicators.overallSignal !== "buy" || !checkRequiredIndicators(indicators, params)) continue;
              }
              if (indicators.overallSignal === "neutral") continue;
              if (params.excludeBBSell && indicators.bbTrend === "sell") continue;
              if (params.requireMaBuy && indicators.maTrend !== "buy") continue;
              if (indicators.rsiValue != null) {
                if (indicators.rsiValue < params.rsiMin || indicators.rsiValue > params.rsiMax) continue;
                if ((params.rsiExcludeMax ?? 0) > 0 && indicators.rsiValue >= (params.rsiExcludeMin ?? 0) && indicators.rsiValue <= params.rsiExcludeMax!) continue;
              }

              if (!(params.requiredIndicators && params.requiredIndicators.length > 0)) {
                if (indicators.maTrend === "sell") {
                  if (!indicators.isMacdCrossover && !indicators.isRsiReversal) continue;
                }
              }

              if (params.requireMacdCrossover && !indicators.isMacdCrossover) continue;
              if (params.requireRsiReversal && !indicators.isRsiReversal) continue;
              if ((params.minSignalScore ?? 0) > 0 && indicators.signalScore < (params.minSignalScore ?? 0)) continue;

              if (params.requireVolumeSurge) {
                const surgeRatio = params.volumeSurgeRatio ?? 1.5;
                const lookback = Math.min(20, globalIdx);
                let avgVol = 0;
                for (let vi = globalIdx - lookback; vi < globalIdx; vi++) avgVol += bars[vi].volume;
                avgVol = avgVol / Math.max(1, lookback);
                if (avgVol > 0 && bars[globalIdx].volume < avgVol * surgeRatio) continue;
              }

              const entryBarGlobal = globalIdx + 1;
              if (entryBarGlobal >= bars.length) continue;

              if (params.requireBreakout) {
                const lookback = params.breakoutLookback ?? 3;
                let recentHigh = -Infinity;
                for (let bi = Math.max(0, globalIdx - lookback); bi <= globalIdx; bi++) {
                  if (bars[bi].high > recentHigh) recentHigh = bars[bi].high;
                }
                if (bars[entryBarGlobal].high < recentHigh) continue;
              }

              const entryBar = bars[entryBarGlobal];
              const buyPrice = entryBar.open;

              if (params.requireEntryConfirm) {
                const confirmBars = params.entryConfirmBars ?? 2;
                let allBelow = true;
                for (let ci = 1; ci <= confirmBars; ci++) {
                  const checkIdx = entryBarGlobal + ci;
                  if (checkIdx >= bars.length) { allBelow = false; break; }
                  if (bars[checkIdx].close > buyPrice) { allBelow = false; break; }
                }
                if (allBelow) continue;
              }

              if ((params.excludePriceMax ?? 0) > 0 && buyPrice >= (params.excludePriceMin ?? 0) && buyPrice < (params.excludePriceMax ?? 0)) continue;

              const maxGapPctVal2 = params.maxGapPercent ?? 2.0;
              if (maxGapPctVal2 > 0 && maxGapPctVal2 < 100) {
                const gapPct = Math.abs((buyPrice - closes[globalIdx]) / closes[globalIdx]) * 100;
                if (gapPct > maxGapPctVal2) continue;
              }

              const confirmDaysVal2 = Math.max(1, params.confirmDays ?? 1);
              if (confirmDaysVal2 > 1) {
                let confirmed = true;
                for (let cd = 1; cd < confirmDaysVal2; cd++) {
                  const prevIdx = globalIdx - cd;
                  if (prevIdx < 0) { confirmed = false; break; }
                  const prevInd = computeIndicatorsAtIndex(closes, prevIdx, 50);
                  if (!prevInd || prevInd.overallSignal !== "buy") { confirmed = false; break; }
                }
                if (!confirmed) continue;
              }

              const entryDay = extractDatePart(entryBar.date);

              const recentCloses = closes.slice(Math.max(0, globalIdx - 20), globalIdx + 1);
              const volatility = recentCloses.length > 1
                ? Math.sqrt(recentCloses.slice(1).reduce((sum, c, idx) => sum + ((c - recentCloses[idx]) / recentCloses[idx]) ** 2, 0) / (recentCloses.length - 1))
                : 0.02;
              if ((params.minVolatility ?? 0) > 0 && volatility * 100 < (params.minVolatility ?? 0)) continue;
              if ((params.minIntradayRange ?? 0) > 0) {
                const rangeLen = Math.min(10, globalIdx - (dayInfo?.startIdx ?? 0) + 1);
                if (rangeLen > 0) {
                  let rangeHigh = -Infinity, rangeLow = Infinity;
                  for (let ri = globalIdx; ri > globalIdx - rangeLen; ri--) {
                    if (bars[ri].high > rangeHigh) rangeHigh = bars[ri].high;
                    if (bars[ri].low < rangeLow) rangeLow = bars[ri].low;
                  }
                  const rangePct = rangeLow > 0 ? ((rangeHigh - rangeLow) / rangeLow) * 100 : 0;
                  if (rangePct < (params.minIntradayRange ?? 0)) continue;
                }
              }

              let effectiveTarget = params.targetPercent;
              if (params.dynamicTarget) {
                const volPercent = volatility * 100;
                const minTarget = stopLoss > 0 ? stopLoss * 1.5 : 0.3;
                effectiveTarget = Math.max(minTarget, Math.min(3.0, volPercent * 0.8));
              }

              const targetMultiplier = 1 + effectiveTarget / 100;
              const targetPrice = Math.round(buyPrice * targetMultiplier * 100) / 100;
              const stopPrice = stopLoss > 0 ? Math.round(buyPrice * (1 - stopLoss / 100) * 100) / 100 : 0;

              let isWin = false;
              let sellPrice = 0;
              let maxHigh = entryBar.high;
              let sellDate = entryBar.date;
              const useTrailingStop2 = params.trailingStop ?? false;
              const trailingStopPct2 = params.trailingStopPercent ?? 1.5;
              let trailingStopPrice2 = 0;

              const entryDayInfo = dayOffsetMap.get(entryDay);
              if (!entryDayInfo) continue;

              const maxHoldBars = params.timeframe === "5m" ? 3 : params.timeframe === "15m" ? 1 : 999;
              const holdLimit = Math.min(entryBarGlobal + maxHoldBars, entryDayInfo.endIdx);
              for (let k = entryBarGlobal; k <= holdLimit; k++) {
                if (bars[k].high >= targetPrice) { isWin = true; sellPrice = targetPrice; sellDate = bars[k].date; break; }
                if (bars[k].high > maxHigh) {
                  maxHigh = bars[k].high;
                  if (useTrailingStop2) {
                    trailingStopPrice2 = Math.round(maxHigh * (1 - trailingStopPct2 / 100) * 100) / 100;
                  }
                }
                if (stopPrice > 0 && bars[k].low <= stopPrice) { isWin = false; sellPrice = stopPrice; sellDate = bars[k].date; break; }
                if (useTrailingStop2 && trailingStopPrice2 > 0 && trailingStopPrice2 > buyPrice && bars[k].low <= trailingStopPrice2) { sellPrice = trailingStopPrice2; sellDate = bars[k].date; isWin = true; break; }
              }

              if (sellPrice === 0) {
                const exitIdx = Math.min(holdLimit, entryDayInfo.endIdx);
                sellPrice = bars[exitIdx].close;
                sellDate = bars[exitIdx].date;
                isWin = sellPrice > buyPrice;
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

  const marketFilter = params.market === "US" ? "US" : params.market === "JP" ? "JP" : undefined;
  const pricedStocks = await storage.getStocksWithPrices(marketFilter);
  const tickers = pricedStocks.map(s => s.ticker);
  const runId = `bt_${Date.now()}`;
  const isIntraday = params.timeframe === "5m" || params.timeframe === "10m" || params.timeframe === "30m";
  const useAiQuantum = params.useAi || params.useQuantum;
  const tfLabels: Record<string, string> = { "5m": "5分足", "10m": "10分足", "30m": "30分足", "1d": "日足" };
  const tfLabel = tfLabels[params.timeframe] || params.timeframe;
  const initialCapital = params.initialCapital ?? 1000000;
  const marketLabel = marketFilter === "US" ? " US米国株" : marketFilter === "JP" ? " JP日本株" : " 全市場";
  const currencyUnit = marketFilter === "US" ? "USD" : "JPY";

  const aiQuantumLabel = useAiQuantum
    ? ` [${params.useAi ? "AI" : ""}${params.useAi && params.useQuantum ? "+" : ""}${params.useQuantum ? "量子" : ""}]`
    : "";

  const capitalLabel = initialCapital > 0
    ? currencyUnit === "USD" ? ` 資金$${initialCapital.toLocaleString()}` : ` 資金${(initialCapital / 10000).toFixed(0)}万円`
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
    label: params.label || `${tfLabel}${marketLabel} 目標${params.targetPercent}% ${params.requiredIndicators?.length ? "必須:" + params.requiredIndicators.map(i => i.toUpperCase()).join("/") : "指標" + params.minBuyIndicators + "+"} RSI${params.rsiMin}-${params.rsiMax}${params.rsiExcludeMin != null && params.rsiExcludeMax != null ? ` 除外${params.rsiExcludeMin}-${params.rsiExcludeMax}` : ""}${params.requireMaBuy ? " MA必須" : ""}${aiQuantumLabel}${capitalLabel}${params.startDate || params.endDate ? ` ${params.startDate || ""}〜${params.endDate || ""}` : ""}`,
    useAi: params.useAi ?? false,
    useQuantum: params.useQuantum ?? false,
    aiThreshold: params.aiThreshold ?? 0.5,
    initialCapital,
    requiredIndicators: params.requiredIndicators ?? null,
  };
  await storage.insertBacktestRun(runConfig);

  let marketTrendMap: Map<string, "up" | "down" | "neutral"> | null = null;
  if (params.requireMarketUptrend && marketFilter !== "US") {
    try {
      const nikkeiPrices = await fetchHistoricalPrices("^N225", "2y", "1d");
      if (nikkeiPrices.length >= 75) {
        marketTrendMap = new Map();
        for (let i = 74; i < nikkeiPrices.length; i++) {
          const ma25 = nikkeiPrices.slice(i - 24, i + 1).reduce((s, p) => s + p.close, 0) / 25;
          const ma75 = nikkeiPrices.slice(i - 74, i + 1).reduce((s, p) => s + p.close, 0) / 75;
          const close = nikkeiPrices[i].close;
          let trend: "up" | "down" | "neutral" = "neutral";
          if (close > ma25 && ma25 > ma75) trend = "up";
          else if (close < ma25 && ma25 < ma75) trend = "down";
          marketTrendMap.set(nikkeiPrices[i].date, trend);
        }
        console.log(`[Backtest] 日経平均トレンドデータ: ${marketTrendMap.size}日分取得`);
      }
    } catch (err: any) {
      console.error("[Backtest] 日経平均データ取得失敗:", err.message);
    }
  }

  cancelRequested = false;
  progress.status = "running";
  progress.total = tickers.length;
  progress.processed = 0;
  progress.signals = 0;
  progress.errors = 0;
  progress.startedAt = Date.now();
  progress.completedAt = null;
  progress.message = `${tfLabel}バックテストを開始しました... (初期資金: ${currencyUnit === "USD" ? `$${initialCapital.toLocaleString()}` : `${(initialCapital / 10000).toFixed(0)}万円`})`;
  progress.runId = runId;
  progress.params = params;
  progress.phase = useAiQuantum ? "scan" : "scan";
  progress.aiFiltered = undefined;
  progress.quantumSelected = undefined;
  progress.skippedByCapital = undefined;
  progress.capitalRemaining = undefined;

  console.log(`[Backtest] ${tickers.length}銘柄の${tfLabel}バックテストを開始 (runId: ${runId}, 初期資金: ${initialCapital}円, AI: ${params.useAi}, 量子: ${params.useQuantum})`);
  console.log(`[Backtest] フィルター設定: 株価除外=${params.excludePriceMin}〜${params.excludePriceMax}円, RSI除外=${params.rsiExcludeMin}〜${params.rsiExcludeMax}`);

  (async () => {
    try {
      const backtestStartMs = Date.now();

      progress.phase = "scan";
      progress.message = `Phase1: シグナルスキャン中...`;

      let allSignals: SignalCandidate[];
      if (useAiQuantum) {
        if (isIntraday) {
          allSignals = await collectIntradaySignals(params, tickers, concurrency);
        } else {
          allSignals = await collectDailySignals(params, tickers, concurrency);
        }
      } else {
        if (isIntraday) {
          allSignals = await collectIntradaySignalsDirect(params, tickers, concurrency);
        } else {
          allSignals = await collectDailySignalsDirect(params, tickers, concurrency);
        }
      }

      const totalRawSignals = allSignals.length;

      if (useAiQuantum && allSignals.length > 0) {
        progress.phase = "ai_quantum";
        progress.message = `Phase2: AI/量子処理中 (${totalRawSignals}件のシグナルを分析)...`;

        try {
          const { processed, summary } = await runAiQuantumPipeline(allSignals, params);
          allSignals = processed;

          const aiPassed = allSignals.filter(s => s.ai_passed !== false).length;
          const quantumSel = allSignals.filter(s => s.quantumSelected !== false).length;
          progress.aiFiltered = totalRawSignals - aiPassed;
          progress.quantumSelected = quantumSel;

          allSignals = allSignals.filter(s => {
            if (params.useAi && s.ai_passed === false) return false;
            if (params.useQuantum && s.quantumSelected === false) return false;
            return true;
          });

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

      if (initialCapital > 0 && allSignals.length > 0) {
        progress.phase = "capital";
        progress.message = `資金シミュレーション中 (${allSignals.length}件, 初期${currencyUnit === "USD" ? `$${initialCapital.toLocaleString()}` : `${(initialCapital / 10000).toFixed(0)}万円`})...`;

        const { executed, skipped, finalCapital } = simulateCapital(allSignals, initialCapital, params.market);
        allSignals = executed;
        progress.skippedByCapital = skipped;
        progress.capitalRemaining = finalCapital;

        console.log(`[Backtest] 資金シミュレーション: ${executed.length}件実行, ${skipped}件スキップ（資金不足）, 最終資金: ${finalCapital}円`);
      }

      progress.phase = "save";
      progress.message = `結果保存中 (${allSignals.length}件)...`;
      await saveSignals(allSignals, runId, params);
      progress.signals = allSignals.length;

      const backtestDurationMs = Date.now() - backtestStartMs;
      logEnergy("backtest", isIntraday ? "日中バックテスト (テクニカル分析)" : "日次バックテスト (テクニカル分析)", "CPU", backtestDurationMs, 0.6, { mode: isIntraday ? "intraday" : "daily", tickers: tickers.length }).catch(() => {});

      progress.completedAt = Date.now();
      progress.phase = undefined;
      const elapsed = Math.round((progress.completedAt - progress.startedAt!) / 1000);
      if (cancelRequested) {
        progress.status = "cancelled";
        progress.message = `キャンセル: ${progress.processed}銘柄処理済み, ${progress.signals}件シグナル (${elapsed}秒)`;
        console.log(`[Backtest] ${progress.message}`);
        cancelRequested = false;
      } else {
        progress.status = "completed";
        const aiQuantumInfo = useAiQuantum
          ? ` (AI除外: ${progress.aiFiltered ?? 0}件, 量子選択: ${progress.quantumSelected ?? "-"}件)`
          : "";
        const capitalInfo = initialCapital > 0
          ? ` (資金不足スキップ: ${progress.skippedByCapital ?? 0}件, 最終資金: ${currencyUnit === "USD" ? `$${(progress.capitalRemaining ?? initialCapital).toLocaleString()}` : `${((progress.capitalRemaining ?? initialCapital) / 10000).toFixed(0)}万円`})`
          : "";
        progress.message = `完了: ${progress.processed}銘柄処理, ${progress.signals}件シグナル${aiQuantumInfo}${capitalInfo} (${elapsed}秒)`;
        console.log(`[Backtest] ${progress.message}`);
      }
    } catch (err: any) {
      progress.status = "error";
      progress.completedAt = Date.now();
      progress.phase = undefined;
      progress.message = `エラー: ${err.message}`;
      console.error("[Backtest] エラー:", err);
    }
  })();
}
