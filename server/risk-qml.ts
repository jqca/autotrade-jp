import { spawn } from "child_process";
import path from "path";
import { storage } from "./storage";
import type { TechnicalIndicator, Stock } from "@shared/schema";
import { logEnergy } from "./energy-monitor";

export interface QmlRiskResult {
  riskScore: number;
  riskLevel: string;
  features: {
    volatility: number;
    volumeRatio: number;
    breadth: number;
    rsiSeverity: number;
    macdSellRatio: number;
  };
  quantumExpectations: number[];
  nQubits: number;
  nLayers: number;
  error?: string;
}

function extractMarketFeatures(indicators: TechnicalIndicator[], stocks: Stock[]) {
  const totalStocks = indicators.length;
  if (totalStocks === 0) {
    return { volatility: 0, volumeRatio: 0.5, breadth: 0, rsiAvg: 50, macdSellRatio: 0 };
  }

  let highVolCount = 0;
  for (const stock of stocks) {
    if (stock.dayHigh > 0 && stock.dayLow > 0 && stock.currentPrice > 0) {
      const range = (stock.dayHigh - stock.dayLow) / stock.currentPrice;
      if (range > 0.03) highVolCount++;
    }
  }
  const volatility = stocks.length > 0 ? highVolCount / stocks.length : 0;

  const priceChanges = stocks.filter(s => s.previousClose > 0).map(s => Math.abs(s.currentPrice - s.previousClose) / s.previousClose);
  const avgChange = priceChanges.length > 0 ? priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length : 0;
  const volumeRatio = Math.min(2.0, avgChange * 50);

  const sellCount = indicators.filter(i => i.overallSignal === "strong_sell" || i.overallSignal === "sell").length;
  const breadth = sellCount / totalStocks;

  const rsiValues = indicators.filter(i => i.rsiValue != null).map(i => i.rsiValue!);
  const rsiAvg = rsiValues.length > 0 ? rsiValues.reduce((a, b) => a + b, 0) / rsiValues.length : 50;

  const macdSellCount = indicators.filter(i => i.macdTrend === "sell").length;
  const macdSellRatio = macdSellCount / totalStocks;

  return { volatility, volumeRatio, breadth, rsiAvg, macdSellRatio };
}

let qmlRunning = false;

function runPythonQml(input: any): Promise<QmlRiskResult> {
  if (qmlRunning) {
    return Promise.reject(new Error("QML process is already running"));
  }
  qmlRunning = true;

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "server", "qml_risk.py");
    const proc = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        qmlRunning = false;
        proc.kill("SIGTERM");
        reject(new Error("QML process timed out (60s)"));
      }
    }, 60000);

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      qmlRunning = false;

      if (code !== 0) {
        reject(new Error(`QML process exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result as QmlRiskResult);
        }
      } catch (e) {
        reject(new Error(`Failed to parse QML output: ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      qmlRunning = false;
      reject(new Error(`Failed to start QML process: ${err.message}`));
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

export async function computeQmlRisk(): Promise<QmlRiskResult> {
  const indicators = await storage.getAllTechnicalIndicators("1d");
  const stocks = await storage.getStocksWithPrices();
  const features = extractMarketFeatures(indicators, stocks);

  try {
    const result = await runPythonQml(features);
    return result;
  } catch (err: any) {
    console.error("[QML Risk] Error:", err.message);
    return {
      riskScore: 0,
      riskLevel: "normal",
      features: { volatility: 0, volumeRatio: 0, breadth: 0, rsiSeverity: 0, macdSellRatio: 0 },
      quantumExpectations: [],
      nQubits: 5,
      nLayers: 3,
      error: err.message,
    };
  }
}

export async function runQmlRiskAssessment(): Promise<QmlRiskResult> {
  const startMs = Date.now();
  const result = await computeQmlRisk();
  const durationMs = Date.now() - startMs;
  if (!result.error) {
    await storage.insertMarketRiskAssessment({
      method: "qml",
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
      volatilityScore: result.features.volatility * 100,
      volumeScore: result.features.volumeRatio * 50,
      breadthScore: result.features.breadth * 100,
      rsiScore: result.features.rsiSeverity * 100,
      correlationScore: result.features.macdSellRatio * 100,
      details: JSON.stringify({
        quantumExpectations: result.quantumExpectations,
        nQubits: result.nQubits,
        nLayers: result.nLayers,
        features: result.features,
      }),
    });
    logEnergy("risk", "量子リスク評価 (QML変分回路)", "QPU+CRYO", durationMs, 0.7, { method: "qml", nQubits: result.nQubits }).catch(() => {});
  }
  return result;
}
