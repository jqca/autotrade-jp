import { fetchHistoricalPrices } from "./yahoo-finance";
import { storage } from "./storage";
import type { InsertIntradayPrice } from "@shared/schema";

export interface IntradayFetchProgress {
  status: "idle" | "running" | "completed" | "error";
  mode: "daily" | "seed" | null;
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

async function fetchIntradayForTicker(ticker: string, range: string): Promise<number> {
  const bars = await fetchHistoricalPrices(ticker, range, "5m");
  if (bars.length === 0) return 0;

  const insertBars: InsertIntradayPrice[] = bars.map(b => ({
    ticker,
    datetime: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    interval: "5m",
  }));

  await storage.bulkInsertIntradayPrices(insertBars);
  return insertBars.length;
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
