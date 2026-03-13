import cron from "node-cron";
import { startFetchAllPrices, getFetchAllProgress } from "./import-stocks";
import { startIndicatorBatch, getIndicatorBatchProgress, startIntradayIndicatorBatch, getIntradayIndicatorBatchProgress } from "./technical-batch";
import { startIntradayFetch, getIntradayFetchProgress } from "./intraday-batch";
import { fetchHistoricalPrices } from "./yahoo-finance";
import { storage } from "./storage";
import type { InsertIntradayPrice } from "@shared/schema";

let scheduledTask: cron.ScheduledTask | null = null;
let lastRunAt: string | null = null;
let nextRunAt: string | null = null;
let isEnabled = true;
let nikkeiStatus: "idle" | "running" | "done" | "error" = "idle";
let nikkeiLastFetchedAt: string | null = null;

async function fetchAndStoreNikkeiDaily(): Promise<void> {
  nikkeiStatus = "running";
  console.log("[Scheduler] 日経平均日足データ取得を開始します...");
  try {
    const prices = await fetchHistoricalPrices("^N225", "2y", "1d");
    if (prices.length === 0) {
      console.warn("[Scheduler] 日経平均日足データが空でした");
      nikkeiStatus = "error";
      return;
    }
    const bars: InsertIntradayPrice[] = prices.map(p => ({
      ticker: "^N225",
      datetime: p.date.split("T")[0],
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume ?? 0,
      interval: "1d",
    }));
    const inserted = await storage.bulkInsertIntradayPrices(bars);
    nikkeiLastFetchedAt = new Date().toISOString();
    nikkeiStatus = "done";
    console.log(`[Scheduler] 日経平均日足データ取得完了: ${prices.length}件取得 (新規${inserted}件保存)`);
  } catch (err: any) {
    nikkeiStatus = "error";
    console.error("[Scheduler] 日経平均日足取得エラー:", err.message);
  }
}

function getNextRunTime(): string {
  const now = new Date();
  const jstOffset = 9 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const jstMinutes = utcMinutes + jstOffset;

  const targetJST = 16 * 60;
  const jstToday = jstMinutes % (24 * 60);

  const next = new Date(now);
  if (jstToday >= targetJST) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  next.setUTCHours(7, 0, 0, 0);
  return next.toISOString();
}

export function startScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  nextRunAt = getNextRunTime();
  console.log(`[Scheduler] 夜間バッチ処理を設定しました。次回実行: ${nextRunAt} (JST 16:00)`);

  scheduledTask = cron.schedule("0 7 * * 1-5", async () => {
    if (!isEnabled) {
      console.log("[Scheduler] バッチ処理は無効化されています。スキップします。");
      return;
    }

    console.log("[Scheduler] 夜間バッチ処理を開始します...");
    lastRunAt = new Date().toISOString();

    try {
      const fetchProgress = getFetchAllProgress();
      if (fetchProgress.status === "running") {
        console.log("[Scheduler] 既に株価取得が実行中です。スキップします。");
        return;
      }
      const indicatorProgress = getIndicatorBatchProgress();
      if (indicatorProgress.status === "running") {
        console.log("[Scheduler] 既にテクニカル指標計算が実行中です。スキップします。");
        return;
      }
      await startFetchAllPrices(3, () => {
        console.log("[Scheduler] 株価取得完了。テクニカル指標の自動計算を開始します...");
        startIndicatorBatch(3, () => {
          console.log("[Scheduler] テクニカル指標計算完了。5分足データ取得を開始します...");
          startIntradayFetch("daily", 3, () => {
            console.log("[Scheduler] 5分足データ取得完了。5分足テクニカル指標計算を開始します...");
            startIntradayIndicatorBatch(3).then(() => {
              console.log("[Scheduler] 5分足テクニカル指標計算完了。日経平均日足データを取得します...");
              fetchAndStoreNikkeiDaily();
            }).catch((err: any) => {
              console.error("[Scheduler] 5分足テクニカル指標バッチエラー:", err.message);
              fetchAndStoreNikkeiDaily();
            });
          }).catch((err: any) => {
            console.error("[Scheduler] 5分足データ取得エラー:", err.message);
          });
        }).catch((err: any) => {
          console.error("[Scheduler] テクニカル指標バッチエラー:", err.message);
        });
      });
      console.log("[Scheduler] 株価取得バッチを開始しました");
    } catch (err: any) {
      console.error("[Scheduler] バッチ処理エラー:", err.message);
    }

    nextRunAt = getNextRunTime();
  }, {
    timezone: "Asia/Tokyo",
  });

  console.log("[Scheduler] スケジューラーが起動しました (月〜金 16:00 JST)");
}

export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log("[Scheduler] スケジューラーを停止しました");
  }
}

export function getSchedulerStatus() {
  const fetchProg = getFetchAllProgress();
  const indicatorProg = getIndicatorBatchProgress();
  const intradayProg = getIntradayFetchProgress();
  const intradayIndicatorProg = getIntradayIndicatorBatchProgress();
  return {
    enabled: isEnabled,
    schedule: "月〜金 16:00 JST (取引終了後)",
    cronExpression: "0 16 * * 1-5 (Asia/Tokyo)",
    lastRunAt,
    nextRunAt: nextRunAt || getNextRunTime(),
    fetchStatus: fetchProg.status,
    fetchProgress: fetchProg.status !== "idle" ? fetchProg : null,
    indicatorStatus: indicatorProg.status,
    indicatorProgress: indicatorProg.status !== "idle" ? indicatorProg : null,
    intradayStatus: intradayProg.status,
    intradayProgress: intradayProg.status !== "idle" ? intradayProg : null,
    intradayIndicatorStatus: intradayIndicatorProg.status,
    intradayIndicatorProgress: intradayIndicatorProg.status !== "idle" ? intradayIndicatorProg : null,
    nikkeiStatus,
    nikkeiLastFetchedAt,
  };
}

export function setSchedulerEnabled(enabled: boolean) {
  isEnabled = enabled;
  console.log(`[Scheduler] バッチ処理を${enabled ? "有効" : "無効"}にしました`);
}
