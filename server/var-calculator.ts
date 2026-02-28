import { spawn } from "child_process";
import path from "path";
import { storage } from "./storage";
import { fetchHistoricalPrices } from "./yahoo-finance";
import { logEnergy } from "./energy-monitor";

export interface VarClassicalResult {
  var: number;
  cvar: number;
  simulations: number;
  percentile_losses: { percentile: number; loss: number }[];
  mean_return: number;
  std_return: number;
}

export interface VarQuantumResult {
  var: number;
  cvar: number;
  n_qubits: number;
  n_shots: number;
  amplitude_estimates: { bin: number; z_value: number; probability: number; loss: number }[];
  quantum_probabilities: number[];
  mean_return: number;
  std_return: number;
  tail_probability: number;
  grover_iterations: number;
}

export interface VarCalculationResponse {
  classical: VarClassicalResult;
  quantum: VarQuantumResult;
  portfolioValue: number;
  confidenceLevel: number;
  holdingDays: number;
  nAssets: number;
  assets: { ticker: string; name: string; currentPrice: number; weight: number }[];
  error?: string;
}

async function fetchPortfolioReturns(tickers: string[], days: number = 90): Promise<number[][]> {
  const allReturns: number[][] = [];

  for (const ticker of tickers) {
    try {
      const range = days <= 90 ? "3mo" : days <= 180 ? "6mo" : "1y";
      const prices = await fetchHistoricalPrices(ticker, range, "1d");
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
    return allReturns.map(() => Array(60).fill(0));
  }

  const minLen = Math.min(...validReturns.map(r => r.length));
  return allReturns.map(r => r.length > 0 ? r.slice(-minLen) : new Array(minLen).fill(0));
}

function runPythonVarCalculation(input: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "server", "quantum_mc_var.py");
    const proc = spawn("python3", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("VaR計算がタイムアウトしました（120秒）"));
      }
    }, 120000);

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`VaR計算エラー: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`VaR出力パースエラー: ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`VaRプロセスエラー: ${err.message}`));
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

export async function calculateVar(
  portfolioValue: number = 1000000,
  confidenceLevel: number = 0.95,
  holdingDays: number = 1,
  nSimulations: number = 10000,
  nQubits: number = 6,
  tickers?: string[]
): Promise<VarCalculationResponse> {
  let targetTickers: string[] = [];
  const stocks = await storage.getStocksWithPrices();
  const stockMap = new Map(stocks.map(s => [s.ticker, s]));

  if (tickers && tickers.length > 0) {
    targetTickers = tickers.filter(t => stockMap.has(t));
  } else {
    const positions = await storage.getAllPositions();
    if (positions.length > 0) {
      targetTickers = positions.map(p => p.stockTicker).filter(t => stockMap.has(t));
    } else {
      const watched = await storage.getWatchedStocks();
      if (watched.length > 0) {
        targetTickers = watched.map(w => w.ticker).slice(0, 10);
      } else {
        targetTickers = stocks.filter(s => s.currentPrice > 0).slice(0, 5).map(s => s.ticker);
      }
    }
  }

  if (targetTickers.length === 0) {
    throw new Error("VaR計算対象の銘柄がありません。ポートフォリオに銘柄を追加するか、ウォッチリストに銘柄を登録してください。");
  }

  const maxTickers = Math.min(targetTickers.length, 12);
  targetTickers = targetTickers.slice(0, maxTickers);

  const returns = await fetchPortfolioReturns(targetTickers);

  const assets = targetTickers.map((ticker, i) => {
    const stock = stockMap.get(ticker)!;
    return {
      ticker,
      name: stock.name,
      currentPrice: stock.currentPrice,
      weight: 1 / targetTickers.length,
    };
  });

  try {
    const varStartMs = Date.now();
    const result = await runPythonVarCalculation({
      returns,
      portfolioValue,
      confidenceLevel,
      holdingDays,
      nSimulations,
      nQubits,
    });
    const varDurationMs = Date.now() - varStartMs;

    if (result.error) {
      throw new Error(result.error);
    }

    logEnergy("var", "古典VaR推定 (モンテカルロ)", "CPU", varDurationMs * 0.4, 0.8, { method: "MonteCarlo", nSimulations }).catch(() => {});
    logEnergy("var", "量子VaR推定 (振幅推定)", "QPU+CRYO", varDurationMs * 0.6, 0.7, { method: "AmplitudeEstimation", nQubits }).catch(() => {});

    return {
      ...result,
      assets,
    };
  } catch (err: any) {
    return {
      classical: {
        var: 0, cvar: 0, simulations: nSimulations,
        percentile_losses: [], mean_return: 0, std_return: 0,
      },
      quantum: {
        var: 0, cvar: 0, n_qubits: nQubits, n_shots: 1024,
        amplitude_estimates: [], quantum_probabilities: [],
        mean_return: 0, std_return: 0, tail_probability: 0, grover_iterations: 0,
      },
      portfolioValue,
      confidenceLevel,
      holdingDays,
      nAssets: targetTickers.length,
      assets,
      error: err.message,
    };
  }
}
