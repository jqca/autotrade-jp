import { storage } from "./storage";
import type { TechnicalIndicator, Stock } from "@shared/schema";

export interface ClassicalRiskResult {
  riskScore: number;
  riskLevel: string;
  volatilityScore: number;
  volumeScore: number;
  breadthScore: number;
  rsiScore: number;
  correlationScore: number;
  details: {
    totalStocks: number;
    sellSignalRatio: number;
    strongSellCount: number;
    avgRsi: number;
    lowRsiCount: number;
    highVolatilityCount: number;
    maDeathCrossRatio: number;
    bbBreakdownCount: number;
    warnings: string[];
  };
}

function classifyRiskLevel(score: number): string {
  if (score >= 80) return "danger";
  if (score >= 60) return "warning";
  if (score >= 40) return "caution";
  return "normal";
}

function riskLevelLabel(level: string): string {
  switch (level) {
    case "danger": return "危険";
    case "warning": return "警戒";
    case "caution": return "注意";
    default: return "正常";
  }
}

export async function computeClassicalRisk(): Promise<ClassicalRiskResult> {
  const indicators = await storage.getAllTechnicalIndicators("1d");
  const stocks = await storage.getStocksWithPrices();

  if (indicators.length === 0) {
    return {
      riskScore: 0,
      riskLevel: "normal",
      volatilityScore: 0,
      volumeScore: 0,
      breadthScore: 0,
      rsiScore: 0,
      correlationScore: 0,
      details: {
        totalStocks: 0,
        sellSignalRatio: 0,
        strongSellCount: 0,
        avgRsi: 50,
        lowRsiCount: 0,
        highVolatilityCount: 0,
        maDeathCrossRatio: 0,
        bbBreakdownCount: 0,
        warnings: ["テクニカル指標データがありません"],
      },
    };
  }

  const stockMap = new Map(stocks.map(s => [s.ticker, s]));
  const totalStocks = indicators.length;

  const sellSignals = indicators.filter(i => i.overallSignal === "strong_sell" || i.overallSignal === "sell");
  const strongSellCount = indicators.filter(i => i.overallSignal === "strong_sell").length;
  const sellSignalRatio = sellSignals.length / totalStocks;

  const rsiValues = indicators.filter(i => i.rsiValue != null).map(i => i.rsiValue!);
  const avgRsi = rsiValues.length > 0 ? rsiValues.reduce((a, b) => a + b, 0) / rsiValues.length : 50;
  const lowRsiCount = rsiValues.filter(v => v <= 30).length;
  const lowRsiRatio = rsiValues.length > 0 ? lowRsiCount / rsiValues.length : 0;

  const maDeathCross = indicators.filter(i => i.maTrend === "sell").length;
  const maDeathCrossRatio = maDeathCross / totalStocks;

  const bbBreakdown = indicators.filter(i => {
    if (i.bbLower == null || i.ticker == null) return false;
    const stock = stockMap.get(i.ticker);
    return stock && stock.currentPrice < i.bbLower;
  }).length;
  const bbBreakdownRatio = totalStocks > 0 ? bbBreakdown / totalStocks : 0;

  let highVolatilityCount = 0;
  for (const stock of stocks) {
    if (stock.dayHigh > 0 && stock.dayLow > 0 && stock.currentPrice > 0) {
      const range = (stock.dayHigh - stock.dayLow) / stock.currentPrice;
      if (range > 0.05) highVolatilityCount++;
    }
  }
  const volatilityRatio = stocks.length > 0 ? highVolatilityCount / stocks.length : 0;

  const macdSellCount = indicators.filter(i => i.macdTrend === "sell").length;
  const macdSellRatio = totalStocks > 0 ? macdSellCount / totalStocks : 0;

  const volatilityScore = Math.min(100, volatilityRatio * 500);
  const volumeScore = Math.min(100, macdSellRatio * 150);
  const breadthScore = Math.min(100, sellSignalRatio * 150 + maDeathCrossRatio * 50);
  const rsiScore = Math.min(100, lowRsiRatio * 200 + Math.max(0, (30 - avgRsi)) * 3);
  const correlationScore = Math.min(100, bbBreakdownRatio * 300 + (strongSellCount / Math.max(1, totalStocks)) * 200);

  const riskScore = Math.min(100, Math.round(
    volatilityScore * 0.2 +
    volumeScore * 0.15 +
    breadthScore * 0.25 +
    rsiScore * 0.25 +
    correlationScore * 0.15
  ));

  const riskLevel = classifyRiskLevel(riskScore);

  const warnings: string[] = [];
  if (sellSignalRatio > 0.5) warnings.push(`全銘柄の${Math.round(sellSignalRatio * 100)}%が売りシグナル`);
  if (strongSellCount > totalStocks * 0.3) warnings.push(`強い売りシグナル: ${strongSellCount}銘柄`);
  if (avgRsi < 35) warnings.push(`市場平均RSI: ${avgRsi.toFixed(1)} (過売り圏)`);
  if (lowRsiRatio > 0.3) warnings.push(`RSI30以下: ${lowRsiCount}銘柄 (${Math.round(lowRsiRatio * 100)}%)`);
  if (maDeathCrossRatio > 0.5) warnings.push(`MA デッドクロス: ${Math.round(maDeathCrossRatio * 100)}%`);
  if (bbBreakdownRatio > 0.3) warnings.push(`BB下限割れ: ${bbBreakdown}銘柄`);
  if (volatilityRatio > 0.2) warnings.push(`高ボラティリティ: ${highVolatilityCount}銘柄`);

  return {
    riskScore,
    riskLevel,
    volatilityScore: Math.round(volatilityScore),
    volumeScore: Math.round(volumeScore),
    breadthScore: Math.round(breadthScore),
    rsiScore: Math.round(rsiScore),
    correlationScore: Math.round(correlationScore),
    details: {
      totalStocks,
      sellSignalRatio,
      strongSellCount,
      avgRsi,
      lowRsiCount,
      highVolatilityCount,
      maDeathCrossRatio,
      bbBreakdownCount: bbBreakdown,
      warnings,
    },
  };
}

export async function runClassicalRiskAssessment(): Promise<ClassicalRiskResult> {
  const result = await computeClassicalRisk();
  await storage.insertMarketRiskAssessment({
    method: "classical",
    riskScore: result.riskScore,
    riskLevel: result.riskLevel,
    volatilityScore: result.volatilityScore,
    volumeScore: result.volumeScore,
    breadthScore: result.breadthScore,
    rsiScore: result.rsiScore,
    correlationScore: result.correlationScore,
    details: JSON.stringify(result.details),
  });
  return result;
}
