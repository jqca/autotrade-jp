import { spawn } from "child_process";
import path from "path";
import { storage } from "./storage";
import { fetchHistoricalPrices } from "./yahoo-finance";
import type { TechnicalIndicator, Stock } from "@shared/schema";
import { logEnergy } from "./energy-monitor";

export interface PortfolioAsset {
  ticker: string;
  name: string;
  currentPrice: number;
  expectedReturn: number;
  signal: string;
  signalLabel: string;
  rsiValue: number | null;
}

export interface OptimizationResult {
  method: string;
  budget: number;
  selectedAssets: {
    ticker: string;
    name: string;
    currentPrice: number;
    allocation: number;
    shares: number;
    investAmount: number;
    expectedReturn: number;
    weight: number;
  }[];
  totalInvested: number;
  remainingCash: number;
  portfolioExpectedReturn: number;
  portfolioRisk: number;
  sharpeRatio: number;
  diversificationScore: number;
}

export interface QaoaDetails {
  nAssets: number;
  nLayers: number;
  qaoaMethod: string;
  topSolutions: { selection: number[]; probability: number; cost: number }[];
}

export interface PortfolioOptimizationResponse {
  classical: OptimizationResult;
  quantum: OptimizationResult;
  qaoaDetails: QaoaDetails;
  candidates: PortfolioAsset[];
  covMatrix: number[][];
}

async function computeReturnsAndCovariance(tickers: string[]): Promise<{
  expectedReturns: number[];
  covMatrix: number[][];
  dailyReturns: number[][];
}> {
  const allReturns: number[][] = [];

  for (const ticker of tickers) {
    try {
      const prices = await fetchHistoricalPrices(ticker, "3mo", "1d");
      if (prices.length < 20) {
        allReturns.push([]);
        continue;
      }
      const returns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        if (prices[i - 1].close > 0) {
          returns.push((prices[i].close - prices[i - 1].close) / prices[i - 1].close);
        }
      }
      allReturns.push(returns);
    } catch {
      allReturns.push([]);
    }
  }

  const validReturns = allReturns.filter(r => r.length > 0);
  if (validReturns.length === 0) {
    const n = tickers.length;
    return {
      expectedReturns: new Array(n).fill(0),
      covMatrix: Array.from({ length: n }, (_, i) => {
        const row = new Array(n).fill(0);
        row[i] = 0.0001;
        return row;
      }),
      dailyReturns: allReturns,
    };
  }

  const minLen = Math.min(...validReturns.map(r => r.length));
  const trimmed = allReturns.map(r => r.length > 0 ? r.slice(-minLen) : new Array(minLen).fill(0));

  const expectedReturns = trimmed.map(r => {
    if (r.length === 0) return 0;
    return r.reduce((a, b) => a + b, 0) / r.length;
  });

  const n = tickers.length;
  const covMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (trimmed[i].length === 0 || trimmed[j].length === 0) continue;
      const meanI = expectedReturns[i];
      const meanJ = expectedReturns[j];
      let cov = 0;
      for (let k = 0; k < minLen; k++) {
        cov += (trimmed[i][k] - meanI) * (trimmed[j][k] - meanJ);
      }
      covMatrix[i][j] = cov / (minLen - 1);
    }
  }

  return { expectedReturns, covMatrix, dailyReturns: trimmed };
}

function classicalMarkowitz(
  expectedReturns: number[],
  covMatrix: number[][],
  prices: number[],
  budget: number,
  riskAversion: number = 0.5
): { selection: number[]; weights: number[] } {
  const n = expectedReturns.length;

  const scores: { idx: number; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    const risk = Math.sqrt(Math.max(0, covMatrix[i][i]));
    const score = expectedReturns[i] - riskAversion * risk;
    scores.push({ idx: i, score });
  }

  scores.sort((a, b) => b.score - a.score);

  const maxSelect = Math.min(n, Math.max(2, Math.floor(n * 0.6)));
  const selected = scores.slice(0, maxSelect).filter(s => s.score > -Infinity);

  const selection = new Array(n).fill(0);
  const weights = new Array(n).fill(0);

  if (selected.length === 0) {
    selection[scores[0].idx] = 1;
    weights[scores[0].idx] = 1;
    return { selection, weights };
  }

  const totalScore = selected.reduce((sum, s) => sum + Math.max(0.01, s.score + 0.01), 0);
  for (const s of selected) {
    selection[s.idx] = 1;
    weights[s.idx] = Math.max(0.01, s.score + 0.01) / totalScore;
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight > 0) {
    for (let i = 0; i < n; i++) {
      weights[i] /= totalWeight;
    }
  }

  return { selection, weights };
}

function buildPortfolioResult(
  method: string,
  selection: number[],
  weights: number[],
  assets: PortfolioAsset[],
  expectedReturns: number[],
  covMatrix: number[][],
  budget: number
): OptimizationResult {
  const selectedIndices = selection.map((s, i) => s === 1 ? i : -1).filter(i => i >= 0);

  if (selectedIndices.length === 0) {
    return {
      method,
      budget,
      selectedAssets: [],
      totalInvested: 0,
      remainingCash: budget,
      portfolioExpectedReturn: 0,
      portfolioRisk: 0,
      sharpeRatio: 0,
      diversificationScore: 0,
    };
  }

  const totalSelectedWeight = selectedIndices.reduce((sum, i) => sum + weights[i], 0);
  const normalizedWeights = selectedIndices.map(i => totalSelectedWeight > 0 ? weights[i] / totalSelectedWeight : 1 / selectedIndices.length);

  const selectedAssets = selectedIndices.map((idx, wi) => {
    const asset = assets[idx];
    const weight = normalizedWeights[wi];
    const investAmount = Math.floor(budget * weight);
    const shares = asset.currentPrice > 0 ? Math.floor(investAmount / (asset.currentPrice * 100)) * 100 : 0;
    const actualInvest = shares * asset.currentPrice;

    return {
      ticker: asset.ticker,
      name: asset.name,
      currentPrice: asset.currentPrice,
      allocation: weight,
      shares,
      investAmount: actualInvest,
      expectedReturn: expectedReturns[idx] * 252 * 100,
      weight,
    };
  }).filter(a => a.shares > 0);

  const totalInvested = selectedAssets.reduce((sum, a) => sum + a.investAmount, 0);

  if (selectedAssets.length === 0 || totalInvested === 0) {
    return {
      method,
      budget,
      selectedAssets: [],
      totalInvested: 0,
      remainingCash: budget,
      portfolioExpectedReturn: 0,
      portfolioRisk: 0,
      sharpeRatio: 0,
      diversificationScore: 0,
    };
  }

  const investedIndices = selectedAssets.map(a => assets.findIndex(as => as.ticker === a.ticker)).filter(i => i >= 0);
  const investedWeights = selectedAssets.map(a => a.investAmount / totalInvested);

  let portfolioReturn = 0;
  let portfolioVariance = 0;
  for (let wi = 0; wi < investedIndices.length; wi++) {
    const i = investedIndices[wi];
    portfolioReturn += investedWeights[wi] * expectedReturns[i];
    for (let wj = 0; wj < investedIndices.length; wj++) {
      const j = investedIndices[wj];
      portfolioVariance += investedWeights[wi] * investedWeights[wj] * covMatrix[i][j];
    }
  }

  const annualReturn = portfolioReturn * 252;
  const annualRisk = Math.sqrt(Math.max(0, portfolioVariance * 252));
  const sharpeRatio = annualRisk > 0 ? annualReturn / annualRisk : 0;

  const avgCorrelation = investedIndices.length > 1
    ? (() => {
        let totalCorr = 0;
        let pairs = 0;
        for (let wi = 0; wi < investedIndices.length; wi++) {
          for (let wj = wi + 1; wj < investedIndices.length; wj++) {
            const i = investedIndices[wi];
            const j = investedIndices[wj];
            const stdI = Math.sqrt(Math.max(0, covMatrix[i][i]));
            const stdJ = Math.sqrt(Math.max(0, covMatrix[j][j]));
            if (stdI > 0 && stdJ > 0) {
              totalCorr += covMatrix[i][j] / (stdI * stdJ);
              pairs++;
            }
          }
        }
        return pairs > 0 ? totalCorr / pairs : 0;
      })()
    : 0;
  const diversificationScore = Math.max(0, (1 - avgCorrelation) * 100);

  return {
    method,
    budget,
    selectedAssets,
    totalInvested,
    remainingCash: budget - totalInvested,
    portfolioExpectedReturn: annualReturn * 100,
    portfolioRisk: annualRisk * 100,
    sharpeRatio,
    diversificationScore,
  };
}

function runQaoaPython(input: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "server", "qaoa_portfolio.py");
    const proc = spawn("python3", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("QAOA process timed out (120s)"));
      }
    }, 120000);

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`QAOA process error: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Failed to parse QAOA output: ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start QAOA: ${err.message}`));
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

export async function optimizePortfolio(
  budget: number,
  riskAversion: number = 0.5,
  maxAssets: number = 10
): Promise<PortfolioOptimizationResponse> {
  const indicators = await storage.getAllTechnicalIndicators("1d");
  const stocks = await storage.getStocksWithPrices();
  const stockMap = new Map(stocks.map(s => [s.ticker, s]));

  const buySignals = indicators.filter(i =>
    (i.overallSignal === "strong_buy" || i.overallSignal === "buy") && stockMap.has(i.ticker)
  );

  buySignals.sort((a, b) => {
    const aStrong = a.overallSignal === "strong_buy" ? 1 : 0;
    const bStrong = b.overallSignal === "strong_buy" ? 1 : 0;
    if (aStrong !== bStrong) return bStrong - aStrong;
    return (a.rsiValue ?? 50) - (b.rsiValue ?? 50);
  });

  const candidates = buySignals.slice(0, maxAssets);

  if (candidates.length === 0) {
    const fallback = indicators
      .filter(i => stockMap.has(i.ticker) && (stockMap.get(i.ticker)?.currentPrice ?? 0) > 0)
      .slice(0, 5);
    candidates.push(...fallback);
  }

  if (candidates.length === 0) {
    throw new Error("最適化対象の銘柄がありません。テクニカル指標を先に計算してください。");
  }

  const assets: PortfolioAsset[] = candidates.map(ind => {
    const stock = stockMap.get(ind.ticker)!;
    return {
      ticker: ind.ticker,
      name: stock.name,
      currentPrice: stock.currentPrice,
      expectedReturn: 0,
      signal: ind.overallSignal || "neutral",
      signalLabel: ind.overallLabel || "",
      rsiValue: ind.rsiValue,
    };
  });

  const tickers = assets.map(a => a.ticker);
  const { expectedReturns, covMatrix } = await computeReturnsAndCovariance(tickers);

  for (let i = 0; i < assets.length; i++) {
    assets[i].expectedReturn = expectedReturns[i] * 252 * 100;
  }

  const optimizeStartMs = Date.now();
  const classicalStartMs = Date.now();
  const classicalResult = classicalMarkowitz(expectedReturns, covMatrix, assets.map(a => a.currentPrice), budget, riskAversion);
  const classical = buildPortfolioResult(
    "classical",
    classicalResult.selection,
    classicalResult.weights,
    assets,
    expectedReturns,
    covMatrix,
    budget
  );
  const classicalDurationMs = Date.now() - classicalStartMs;

  let quantum: OptimizationResult;
  let qaoaDetails: QaoaDetails;
  let qaoaDurationMs = 0;

  try {
    const qaoaInput = {
      expectedReturns: expectedReturns.map(r => r * 1000),
      covMatrix: covMatrix.map(row => row.map(v => v * 1000)),
      riskAversion,
      budgetPenalty: 2.0,
      qaoaLayers: 2,
    };

    const qaoaStartMs = Date.now();
    const qaoaResult = await runQaoaPython(qaoaInput);
    qaoaDurationMs = Date.now() - qaoaStartMs;

    if (qaoaResult.error) {
      throw new Error(qaoaResult.error);
    }

    const qSelection = qaoaResult.selection as number[];
    const selectedCount = qSelection.filter(s => s === 1).length;
    const qWeights = qSelection.map(s => s === 1 ? 1 / Math.max(1, selectedCount) : 0);

    quantum = buildPortfolioResult(
      "quantum_qaoa",
      qSelection,
      qWeights,
      assets,
      expectedReturns,
      covMatrix,
      budget
    );

    qaoaDetails = {
      nAssets: qaoaResult.nAssets,
      nLayers: qaoaResult.nLayers,
      qaoaMethod: qaoaResult.method,
      topSolutions: qaoaResult.topSolutions || [],
    };
  } catch (err: any) {
    console.error("[QAOA] Error:", err.message);
    quantum = {
      ...classical,
      method: "quantum_qaoa_fallback",
    };
    qaoaDetails = {
      nAssets: assets.length,
      nLayers: 0,
      qaoaMethod: "error: " + err.message,
      topSolutions: [],
    };
  }

  const totalDuration = Date.now() - optimizeStartMs;
  logEnergy("portfolio", "古典ポートフォリオ最適化 (Markowitz)", "CPU", totalDuration - qaoaDurationMs, 0.7, { method: "Markowitz", nAssets: assets.length }).catch(() => {});
  if (qaoaDurationMs > 0) {
    logEnergy("portfolio", "量子ポートフォリオ最適化 (QAOA)", "QPU+CRYO", qaoaDurationMs, 0.7, { method: "QAOA", nAssets: assets.length }).catch(() => {});
  }

  return { classical, quantum, qaoaDetails, candidates: assets, covMatrix };
}
