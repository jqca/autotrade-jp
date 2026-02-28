import { fetchHistoricalPrices, type HistoricalPrice } from "./yahoo-finance";
import { storage } from "./storage";
import type { InsertIntradayPrice } from "@shared/schema";

export interface IntradayFetchProgress {
  status: "idle" | "running" | "completed" | "error";
  mode: "daily" | "seed" | "aggregate" | null;
  total: number;
  processed: number;
  stored: number;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string;
}

const progress: IntradayFetchProgress = {
  status: "idle",
  mode: null,
  total: 0,
  processed: 0,
  stored: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
  message: "",
};

export function getIntradayFetchProgress(): IntradayFetchProgress {
  return { ...progress };
}

function aggregateBarsToInterval(bars: HistoricalPrice[], minutesPer: number): HistoricalPrice[] {
  if (bars.length === 0 || minutesPer <= 5) return [];
  const groups = new Map<string, HistoricalPrice[]>();
  for (const bar of bars) {
    const d = new Date(bar.date.includes("T") ? bar.date : bar.date.replace(" ", "T"));
    if (isNaN(d.getTime())) continue;
    const totalMin = d.getHours() * 60 + d.getMinutes();
    const bucket = Math.floor(totalMin / minutesPer) * minutesPer;
    const bH = String(Math.floor(bucket / 60)).padStart(2, "0");
    const bM = String(bucket % 60).padStart(2, "0");
    const datePart = bar.date.split(/[T ]/)[0];
    const key = `${datePart}T${bH}:${bM}`;
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
      volume: group.reduce((s, b) => s + b.volume, 0),
    });
  }
  return result;
}

async function fetchIntradayForTicker(ticker: string, range: string): Promise<number> {
  const bars = await fetchHistoricalPrices(ticker, range, "5m");
  if (bars.length === 0) return 0;

  const insertBars5m: InsertIntradayPrice[] = bars.map(b => ({
    ticker,
    datetime: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    interval: "5m",
  }));

  const bars10m = aggregateBarsToInterval(bars, 10);
  const insert10m: InsertIntradayPrice[] = bars10m.map(b => ({
    ticker, datetime: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, interval: "10m",
  }));

  const bars30m = aggregateBarsToInterval(bars, 30);
  const insert30m: InsertIntradayPrice[] = bars30m.map(b => ({
    ticker, datetime: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, interval: "30m",
  }));

  const allBars = [...insertBars5m, ...insert10m, ...insert30m];
  await storage.bulkInsertIntradayPrices(allBars);
  return allBars.length;
}

export async function aggregateStoredIntradayData(): Promise<{ tickers: number; bars10m: number; bars30m: number }> {
  if (progress.status === "running") {
    throw new Error("既にイントラデイデータ処理が実行中です");
  }

  progress.status = "running";
  progress.mode = "aggregate";
  progress.startedAt = Date.now();
  progress.completedAt = null;
  progress.message = "既存5分足データから10分足・30分足を生成中...";

  const tickers = await storage.getAllStockTickers();
  progress.total = tickers.length;
  progress.processed = 0;
  progress.stored = 0;
  progress.errors = 0;

  let total10m = 0;
  let total30m = 0;
  let tickerCount = 0;

  try {
    for (let i = 0; i < tickers.length; i += 10) {
      const batch = tickers.slice(i, i + 10);
      await Promise.allSettled(
        batch.map(async (ticker) => {
          try {
            const stored5m = await storage.getIntradayPrices(ticker, undefined, undefined, "5m");
            if (stored5m.length === 0) {
              progress.processed++;
              return;
            }

            const bars5m: HistoricalPrice[] = stored5m.map(b => ({
              date: b.datetime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
            }));

            const bars10m = aggregateBarsToInterval(bars5m, 10);
            const bars30m = aggregateBarsToInterval(bars5m, 30);

            const inserts: InsertIntradayPrice[] = [
              ...bars10m.map(b => ({ ticker, datetime: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, interval: "10m" as const })),
              ...bars30m.map(b => ({ ticker, datetime: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, interval: "30m" as const })),
            ];

            if (inserts.length > 0) {
              const inserted = await storage.bulkInsertIntradayPrices(inserts);
              progress.stored += inserted;
              total10m += bars10m.length;
              total30m += bars30m.length;
              if (inserted > 0) tickerCount++;
            }
          } catch {
            progress.errors++;
          }
          progress.processed++;
        })
      );
      progress.message = `${progress.processed}/${progress.total} 処理済み (10分足: ${total10m}本, 30分足: ${total30m}本)`;
    }

    progress.status = "completed";
    progress.completedAt = Date.now();
    const elapsed = Math.round((progress.completedAt - progress.startedAt!) / 1000);
    progress.message = `集約完了: ${tickerCount}銘柄, 10分足${total10m}本, 30分足${total30m}本 (${elapsed}秒)`;
    console.log(`[IntradayBatch] ${progress.message}`);
  } catch (err: any) {
    progress.status = "error";
    progress.completedAt = Date.now();
    progress.message = `集約エラー: ${err.message}`;
  }

  return { tickers: tickerCount, bars10m: total10m, bars30m: total30m };
}

export async function startIntradayFetch(
  mode: "daily" | "seed" = "daily",
  concurrency: number = 3,
  onComplete?: () => void,
): Promise<void> {
  if (progress.status === "running") {
    throw new Error("既にイントラデイデータ取得が実行中です");
  }

  const tickers = await storage.getAllStockTickers();
  const range = mode === "seed" ? "60d" : "1d";

  progress.status = "running";
  progress.mode = mode;
  progress.total = tickers.length;
  progress.processed = 0;
  progress.stored = 0;
  progress.errors = 0;
  progress.startedAt = Date.now();
  progress.completedAt = null;
  progress.message = `${mode === "seed" ? "初回シード(60日分)" : "当日分"}の5分足データ取得を開始...`;

  console.log(`[IntradayBatch] ${progress.message} (${tickers.length}銘柄)`);

  (async () => {
    try {
      for (let i = 0; i < tickers.length; i += concurrency) {
        const batch = tickers.slice(i, i + concurrency);

        const results = await Promise.allSettled(
          batch.map(async (ticker) => {
            try {
              return await fetchIntradayForTicker(ticker, range);
            } catch {
              return 0;
            }
          })
        );

        for (const r of results) {
          progress.processed++;
          if (r.status === "fulfilled" && r.value > 0) {
            progress.stored += r.value;
          } else if (r.status === "rejected") {
            progress.errors++;
          }
        }

        progress.message = `${progress.processed}/${progress.total} 処理済み (${progress.stored}本保存)`;

        if (i + concurrency < tickers.length) {
          await new Promise(r => setTimeout(r, mode === "seed" ? 800 : 300));
        }
      }

      const cleaned = await storage.cleanupOldIntradayData(120);
      if (cleaned > 0) {
        console.log(`[IntradayBatch] 古いデータ${cleaned}件を削除しました (120日保持)`);
      }

      progress.status = "completed";
      progress.completedAt = Date.now();
      const elapsed = Math.round((progress.completedAt - progress.startedAt!) / 1000);
      progress.message = `完了: ${progress.stored}本保存, ${progress.errors}件エラー (${elapsed}秒)`;
      console.log(`[IntradayBatch] ${progress.message}`);

      if (onComplete) onComplete();
    } catch (err: any) {
      progress.status = "error";
      progress.completedAt = Date.now();
      progress.message = `エラー: ${err.message}`;
      console.error("[IntradayBatch] エラー:", err);

      if (onComplete) onComplete();
    }
  })();
}
