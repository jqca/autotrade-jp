import { db } from "./server/db";
import { backtestResults } from "./shared/schema";
import { eq, desc } from "drizzle-orm";

async function analyze() {
  const latestRun = await db.select({ runId: backtestResults.runId })
    .from(backtestResults)
    .orderBy(desc(backtestResults.createdAt))
    .limit(1);
  
  if (!latestRun.length) { console.log("No results"); process.exit(0); }
  const runId = latestRun[0].runId;
  const results = await db.select().from(backtestResults).where(eq(backtestResults.runId, runId!));

  console.log(`=== 日足確認フィルター分析 (RunID: ${runId}, ${results.length}件) ===\n`);

  // Check MA trend distribution
  const maTrends = { buy: { w: 0, l: 0 }, sell: { w: 0, l: 0 }, neutral: { w: 0, l: 0 } };
  for (const r of results) {
    const trend = r.maTrend as string;
    if (maTrends[trend as keyof typeof maTrends]) {
      if (r.isWin) maTrends[trend as keyof typeof maTrends].w++;
      else maTrends[trend as keyof typeof maTrends].l++;
    }
  }
  
  console.log("=== MAトレンド別 勝率 ===");
  for (const [trend, counts] of Object.entries(maTrends)) {
    const total = counts.w + counts.l;
    if (total > 0) {
      console.log(`  MA=${trend}: ${counts.w}W/${counts.l}L (${total}件) 勝率=${(counts.w/total*100).toFixed(1)}%`);
    }
  }

  // Check combined indicator analysis  
  console.log("\n=== 指標組み合わせ別 勝率 ===");
  const combos: Record<string, { w: number, l: number, plSum: number }> = {};
  for (const r of results) {
    const key = `MACD=${r.macdTrend} RSI=${r.rsiTrend} MA=${r.maTrend} BB=${r.bbTrend}`;
    if (!combos[key]) combos[key] = { w: 0, l: 0, plSum: 0 };
    if (r.isWin) combos[key].w++;
    else combos[key].l++;
    combos[key].plSum += Number(r.profitLossPercent);
  }
  for (const [key, v] of Object.entries(combos).sort((a,b) => (b[1].w/(b[1].w+b[1].l)) - (a[1].w/(a[1].w+a[1].l)))) {
    const total = v.w + v.l;
    console.log(`  ${key}: ${v.w}W/${v.l}L 勝率=${(v.w/total*100).toFixed(1)}% 合計PL=${v.plSum.toFixed(2)}%`);
  }

  // Simulate daily confirm filter: only allow trades where MA is buy or neutral (not sell)
  console.log("\n=== 日足確認フィルター シミュレーション ===");
  console.log("(MA=sellを除外 → MA=buy/neutralのみ許可)");
  const filtered = results.filter(r => r.maTrend !== "sell");
  const fWins = filtered.filter(r => r.isWin);
  const fLosses = filtered.filter(r => !r.isWin);
  const fPL = filtered.reduce((s, r) => s + Number(r.profitLossPercent), 0);
  console.log(`  フィルター前: ${results.filter(r=>r.isWin).length}W/${results.filter(r=>!r.isWin).length}L (${results.length}件) 勝率=${(results.filter(r=>r.isWin).length/results.length*100).toFixed(1)}%`);
  console.log(`  フィルター後: ${fWins.length}W/${fLosses.length}L (${filtered.length}件) 勝率=${filtered.length > 0 ? (fWins.length/filtered.length*100).toFixed(1) : "N/A"}%`);
  console.log(`  合計PL: ${fPL.toFixed(2)}%`);

  // Also check: requireDailyConfirm means checking daily indicators on intraday signals
  // What does the actual filter do?
  console.log("\n=== MA=sell トレード一覧 ===");
  const sellTrades = results.filter(r => r.maTrend === "sell");
  for (const r of sellTrades) {
    console.log(`  ${r.ticker} MA=sell ${r.isWin ? "勝ち" : "負け"} PL=${Number(r.profitLossPercent).toFixed(2)}% RSI=${r.rsiValue} MACD=${r.macdTrend}`);
  }

  process.exit(0);
}
analyze().catch(e => { console.error(e); process.exit(1); });
