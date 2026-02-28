import { spawn } from "child_process";
import path from "path";
import { storage } from "./storage";
import { fetchHistoricalPrices } from "./yahoo-finance";
import { logEnergy } from "./energy-monitor";

let benchmarkRunning = false;

export interface BenchmarkResult {
  risk: any;
  portfolio: any;
  var: any;
  kernel: any;
  scaling: any;
  summary: any;
  error?: string;
}

export function isBenchmarkRunning(): boolean {
  return benchmarkRunning;
}

async function gatherRealData(): Promise<any> {
  const indicators = await storage.getAllTechnicalIndicators("1d");
  const stocks = await storage.getStocksWithPrices();
  const positions = await storage.getAllPositions();

  const riskScenarios: any[] = [];
  const stocksWithIndicators = stocks.filter(s => s.currentPrice > 0 && s.previousClose > 0);
  const totalStocks = stocksWithIndicators.length;

  if (totalStocks > 0) {
    const dayRanges = stocksWithIndicators.map(s =>
      s.dayHigh && s.dayLow && s.currentPrice > 0
        ? (s.dayHigh - s.dayLow) / s.currentPrice
        : 0
    );
    const avgRange = dayRanges.reduce((a, b) => a + b, 0) / totalStocks;
    const volatilityNorm = Math.min(1, avgRange / 0.06);

    const priceChanges = stocksWithIndicators.map(s =>
      (s.currentPrice - s.previousClose) / s.previousClose
    );
    const avgChange = priceChanges.reduce((a, b) => a + b, 0) / totalStocks;
    const volumeRatio = Math.min(1, Math.max(0, 0.5 + avgChange * 10));

    const sellSignals = indicators.filter(i =>
      i.overallSignal === "sell" || i.overallSignal === "strong_sell"
    ).length;
    const breadth = Math.min(1, sellSignals / Math.max(1, indicators.length));

    const rsiValues = indicators.filter(i => i.rsiValue != null).map(i => i.rsiValue!);
    const avgRsi = rsiValues.length > 0 ? rsiValues.reduce((a, b) => a + b, 0) / rsiValues.length : 50;
    const rsiSeverity = Math.min(1, Math.max(0, (avgRsi - 30) / 40));

    const macdSells = indicators.filter(i => i.macdTrend === "sell").length;
    const macdSellRatio = Math.min(1, macdSells / Math.max(1, indicators.length));

    riskScenarios.push({
      ticker: "市場全体",
      volatility: volatilityNorm,
      volume_ratio: volumeRatio,
      breadth: breadth,
      rsi_severity: rsiSeverity,
      macd_sell: macdSellRatio,
      is_crisis: volatilityNorm > 0.6 && breadth > 0.4,
    });

    const sectors = [...new Set(stocksWithIndicators.map(s => s.sector).filter(Boolean))];
    for (const sector of sectors.slice(0, 15)) {
      const sectorStocks = stocksWithIndicators.filter(s => s.sector === sector);
      if (sectorStocks.length < 3) continue;
      const sRanges = sectorStocks.map(s =>
        s.dayHigh && s.dayLow && s.currentPrice > 0 ? (s.dayHigh - s.dayLow) / s.currentPrice : 0
      );
      const sVol = Math.min(1, (sRanges.reduce((a, b) => a + b, 0) / sectorStocks.length) / 0.06);
      const sChanges = sectorStocks.map(s => (s.currentPrice - s.previousClose) / s.previousClose);
      const sAvgChange = sChanges.reduce((a, b) => a + b, 0) / sectorStocks.length;
      const sVolRatio = Math.min(1, Math.max(0, 0.5 + sAvgChange * 10));

      const sIndicators = indicators.filter(i =>
        sectorStocks.some(s => s.ticker === i.ticker)
      );
      const sSells = sIndicators.filter(i => i.overallSignal === "sell" || i.overallSignal === "strong_sell").length;
      const sBreadth = Math.min(1, sSells / Math.max(1, sIndicators.length));
      const sRsiVals = sIndicators.filter(i => i.rsiValue != null).map(i => i.rsiValue!);
      const sAvgRsi = sRsiVals.length > 0 ? sRsiVals.reduce((a, b) => a + b, 0) / sRsiVals.length : 50;
      const sRsiSev = Math.min(1, Math.max(0, (sAvgRsi - 30) / 40));
      const sMacdSells = sIndicators.filter(i => i.macdTrend === "sell").length;
      const sMacdRatio = Math.min(1, sMacdSells / Math.max(1, sIndicators.length));

      riskScenarios.push({
        ticker: sector,
        volatility: sVol,
        volume_ratio: sVolRatio,
        breadth: sBreadth,
        rsi_severity: sRsiSev,
        macd_sell: sMacdRatio,
        is_crisis: sVol > 0.6 && sBreadth > 0.4,
      });
    }
  }

  const buySignalStocks = indicators
    .filter(i => i.overallSignal === "strong_buy" || i.overallSignal === "buy")
    .sort((a, b) => (a.rsiValue ?? 100) - (b.rsiValue ?? 100))
    .slice(0, 10);

  const candidateTickers = buySignalStocks.map(i => i.ticker);
  if (candidateTickers.length < 4) {
    const topStocks = stocksWithIndicators
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 10);
    for (const s of topStocks) {
      if (!candidateTickers.includes(s.ticker)) {
        candidateTickers.push(s.ticker);
        if (candidateTickers.length >= 8) break;
      }
    }
  }

  const portfolioAssets: any[] = [];
  const allReturns: number[] = [];
  const returnsByAsset: number[][] = [];
  const assetNames: string[] = [];

  for (const ticker of candidateTickers.slice(0, 10)) {
    try {
      const prices = await fetchHistoricalPrices(ticker, "3mo", "1d");
      if (prices.length < 20) continue;
      const returns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i].close - prices[i - 1].close) / prices[i - 1].close);
      }
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const stock = stocksWithIndicators.find(s => s.ticker === ticker);
      portfolioAssets.push({
        ticker,
        name: stock?.name || ticker,
        expected_return: meanReturn,
      });
      returnsByAsset.push(returns);
      allReturns.push(...returns);
      assetNames.push(stock?.name || ticker);
    } catch {
      // skip
    }
  }

  let covMatrix: number[][] = [];
  if (returnsByAsset.length >= 2) {
    const minLen = Math.min(...returnsByAsset.map(r => r.length));
    const aligned = returnsByAsset.map(r => r.slice(0, minLen));
    const n = aligned.length;
    covMatrix = Array.from({ length: n }, () => Array(n).fill(0));
    const means = aligned.map(r => r.reduce((a, b) => a + b, 0) / r.length);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let cov = 0;
        for (let k = 0; k < minLen; k++) {
          cov += (aligned[i][k] - means[i]) * (aligned[j][k] - means[j]);
        }
        covMatrix[i][j] = cov / (minLen - 1);
      }
    }
  }

  let varReturns: number[] = [];
  if (returnsByAsset.length > 0) {
    const minLen = Math.min(...returnsByAsset.map(r => r.length));
    for (let k = 0; k < minLen; k++) {
      let portfolioReturn = 0;
      for (let a = 0; a < returnsByAsset.length; a++) {
        portfolioReturn += returnsByAsset[a][k] / returnsByAsset.length;
      }
      varReturns.push(portfolioReturn);
    }
  }

  const kernelFeatures: any[] = [];
  for (const ind of indicators.slice(0, 60)) {
    const stock = stocksWithIndicators.find(s => s.ticker === ind.ticker);
    if (!stock) continue;
    const vol = stock.dayHigh && stock.dayLow && stock.currentPrice > 0
      ? (stock.dayHigh - stock.dayLow) / stock.currentPrice : 0;
    kernelFeatures.push({
      ticker: ind.ticker,
      volatility: Math.min(1, vol / 0.06),
      rsi_norm: Math.min(1, Math.max(0, (ind.rsiValue ?? 50) / 100)),
      breadth: ind.overallSignal === "sell" || ind.overallSignal === "strong_sell" ? 0.8 : 0.2,
      macd_norm: ind.macdTrend === "sell" ? 0.7 : 0.3,
      label: (ind.overallSignal === "sell" || ind.overallSignal === "strong_sell") ? 1 : 0,
    });
  }

  return {
    risk_scenarios: riskScenarios,
    portfolio_assets: portfolioAssets,
    cov_matrix: covMatrix,
    var_returns: varReturns,
    var_asset_names: assetNames,
    portfolio_value: 1000000,
    kernel_features: kernelFeatures,
    stock_count: totalStocks,
  };
}

export async function runQuantumBenchmark(useRealData: boolean = true): Promise<BenchmarkResult> {
  if (benchmarkRunning) {
    throw new Error("ベンチマークが既に実行中です");
  }

  benchmarkRunning = true;
  const startTime = Date.now();

  try {
    let inputData: any = null;
    let stockCount = 0;

    if (useRealData) {
      try {
        inputData = await gatherRealData();
        stockCount = inputData.stock_count || 0;
      } catch (err) {
        console.error("[Benchmark] 実データ取得失敗、合成データで実行:", err);
        inputData = null;
      }
    }

    const result = await new Promise<BenchmarkResult>((resolve, reject) => {
      const scriptPath = path.join(process.cwd(), "server", "quantum_benchmark.py");
      const proc = spawn("python3", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill("SIGTERM");
          reject(new Error("ベンチマークがタイムアウトしました（300秒）"));
        }
      }, 300000);

      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`ベンチマークエラー: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`ベンチマーク出力パースエラー: ${stdout.slice(0, 200)}`));
        }
      });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`ベンチマークプロセスエラー: ${err.message}`));
      });

      if (inputData) {
        proc.stdin.write(JSON.stringify(inputData));
      }
      proc.stdin.end();
    });

    const executionTimeMs = Date.now() - startTime;
    const dataSource = result.summary?.data_source || (inputData ? "real" : "synthetic");

    try {
      await storage.insertBenchmarkRun({
        dataSource,
        riskResult: JSON.stringify(result.risk),
        portfolioResult: JSON.stringify(result.portfolio),
        varResult: JSON.stringify(result.var),
        kernelResult: JSON.stringify(result.kernel),
        scalingResult: JSON.stringify(result.scaling),
        summary: JSON.stringify(result.summary),
        stockCount,
        executionTimeMs,
      });
    } catch (err) {
      console.error("[Benchmark] DB保存エラー:", err);
    }

    try {
      const riskAiMs = result.risk?.scenarios?.[0]?.ai_time_ms ? result.risk.scenarios.reduce((s: number, sc: any) => s + (sc.ai_time_ms || 0), 0) : executionTimeMs * 0.3;
      const riskQMs = result.risk?.scenarios?.[0]?.quantum_time_ms ? result.risk.scenarios.reduce((s: number, sc: any) => s + (sc.quantum_time_ms || 0), 0) : executionTimeMs * 0.2;
      const portAiMs = result.portfolio?.classical?.time_ms || executionTimeMs * 0.1;
      const portQMs = result.portfolio?.quantum?.time_ms || executionTimeMs * 0.15;
      const varAiMs = result.var?.classical?.time_ms || executionTimeMs * 0.1;
      const varQMs = result.var?.quantum?.time_ms || executionTimeMs * 0.1;

      await logEnergy("benchmark", "リスク検知 (AI/GBM)", "CPU", riskAiMs, 0.8, { domain: "risk", method: "GradientBoosting" });
      await logEnergy("benchmark", "リスク検知 (量子/QML)", "QPU+CRYO", riskQMs, 0.7, { domain: "risk", method: "QML" });
      await logEnergy("benchmark", "ポートフォリオ最適化 (古典/Markowitz)", "CPU", portAiMs, 0.8, { domain: "portfolio", method: "Markowitz" });
      await logEnergy("benchmark", "ポートフォリオ最適化 (量子/QAOA)", "QPU+CRYO", portQMs, 0.7, { domain: "portfolio", method: "QAOA" });
      await logEnergy("benchmark", "VaR推定 (古典/モンテカルロ)", "CPU", varAiMs, 0.8, { domain: "var", method: "MonteCarlo" });
      await logEnergy("benchmark", "VaR推定 (量子/振幅推定)", "QPU+CRYO", varQMs, 0.7, { domain: "var", method: "AmplitudeEstimation" });
    } catch (err) {
      console.error("[Benchmark] エネルギーログエラー:", err);
    }

    return result;
  } finally {
    benchmarkRunning = false;
  }
}
