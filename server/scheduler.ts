import cron from "node-cron";
import { startFetchAllPrices, getFetchAllProgress } from "./import-stocks";
import { startIndicatorBatch, getIndicatorBatchProgress } from "./technical-batch";

let scheduledTask: cron.ScheduledTask | null = null;
let lastRunAt: string | null = null;
let nextRunAt: string | null = null;
let isEnabled = true;

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
        startIndicatorBatch(3).catch((err: any) => {
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
  };
}

export function setSchedulerEnabled(enabled: boolean) {
  isEnabled = enabled;
  console.log(`[Scheduler] バッチ処理を${enabled ? "有効" : "無効"}にしました`);
}
