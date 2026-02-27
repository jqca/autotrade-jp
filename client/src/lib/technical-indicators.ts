interface PricePoint {
  date: string;
  close: number;
  high: number;
  low: number;
}

export interface MAData {
  date: string;
  close: number;
  ma5: number | null;
  ma25: number | null;
  ma75: number | null;
}

export interface BollingerData {
  date: string;
  close: number;
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

export interface RSIData {
  date: string;
  rsi: number | null;
}

export interface MACDData {
  date: string;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export type SignalType = "buy" | "sell" | "neutral";

export interface SignalSummary {
  macd: { signal: SignalType; label: string };
  rsi: { signal: SignalType; label: string; value: number | null };
  ma: { signal: SignalType; label: string };
  bollinger: { signal: SignalType; label: string };
  overall: { signal: SignalType; label: string };
}

function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = data[0];
  result.push(prev);
  for (let i = 1; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

export function calcMovingAverages(prices: PricePoint[]): MAData[] {
  const closes = prices.map(p => p.close);
  const ma5 = sma(closes, 5);
  const ma25 = sma(closes, 25);
  const ma75 = sma(closes, 75);
  return prices.map((p, i) => ({
    date: p.date,
    close: p.close,
    ma5: ma5[i] != null ? Math.round(ma5[i]! * 10) / 10 : null,
    ma25: ma25[i] != null ? Math.round(ma25[i]! * 10) / 10 : null,
    ma75: ma75[i] != null ? Math.round(ma75[i]! * 10) / 10 : null,
  }));
}

export function calcBollingerBands(prices: PricePoint[], period: number = 20, multiplier: number = 2): BollingerData[] {
  const closes = prices.map(p => p.close);
  const middle = sma(closes, period);

  return prices.map((p, i) => {
    if (middle[i] == null) {
      return { date: p.date, close: p.close, upper: null, middle: null, lower: null };
    }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - middle[i]!) ** 2;
    }
    const stdDev = Math.sqrt(sumSq / period);
    return {
      date: p.date,
      close: p.close,
      upper: Math.round((middle[i]! + multiplier * stdDev) * 10) / 10,
      middle: Math.round(middle[i]! * 10) / 10,
      lower: Math.round((middle[i]! - multiplier * stdDev) * 10) / 10,
    };
  });
}

export function calcRSI(prices: PricePoint[], period: number = 14): RSIData[] {
  const closes = prices.map(p => p.close);
  const result: RSIData[] = [{ date: prices[0].date, rsi: null }];

  let prevAvgGain = 0;
  let prevAvgLoss = 0;

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    if (i < period) {
      prevAvgGain += gain;
      prevAvgLoss += loss;
      result.push({ date: prices[i].date, rsi: null });
    } else if (i === period) {
      prevAvgGain = (prevAvgGain + gain) / period;
      prevAvgLoss = (prevAvgLoss + loss) / period;
      const rs = prevAvgLoss === 0 ? 100 : prevAvgGain / prevAvgLoss;
      result.push({ date: prices[i].date, rsi: Math.round((100 - 100 / (1 + rs)) * 100) / 100 });
    } else {
      prevAvgGain = (prevAvgGain * (period - 1) + gain) / period;
      prevAvgLoss = (prevAvgLoss * (period - 1) + loss) / period;
      const rs = prevAvgLoss === 0 ? 100 : prevAvgGain / prevAvgLoss;
      result.push({ date: prices[i].date, rsi: Math.round((100 - 100 / (1 + rs)) * 100) / 100 });
    }
  }
  return result;
}

export function calcMACD(prices: PricePoint[], fast: number = 12, slow: number = 26, signalPeriod: number = 9): MACDData[] {
  const closes = prices.map(p => p.close);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
  const signalLine = ema(macdLine, signalPeriod);

  return prices.map((p, i) => {
    const hasEnoughData = i >= slow - 1;
    return {
      date: p.date,
      macd: hasEnoughData ? Math.round(macdLine[i] * 100) / 100 : null,
      signal: hasEnoughData ? Math.round(signalLine[i] * 100) / 100 : null,
      histogram: hasEnoughData ? Math.round((macdLine[i] - signalLine[i]) * 100) / 100 : null,
    };
  });
}

export function calcSignals(prices: PricePoint[]): SignalSummary {
  const macdData = calcMACD(prices);
  const rsiData = calcRSI(prices);
  const maData = calcMovingAverages(prices);
  const bbData = calcBollingerBands(prices);

  const lastMacd = macdData.filter(d => d.macd != null);
  const macdSignal: SignalSummary["macd"] = (() => {
    if (lastMacd.length < 2) return { signal: "neutral", label: "データ不足" };
    const curr = lastMacd[lastMacd.length - 1];
    const prev = lastMacd[lastMacd.length - 2];
    if (prev.macd! <= prev.signal! && curr.macd! > curr.signal!) {
      return { signal: "buy", label: "ゴールデンクロス（買い）" };
    }
    if (prev.macd! >= prev.signal! && curr.macd! < curr.signal!) {
      return { signal: "sell", label: "デッドクロス（売り）" };
    }
    if (curr.macd! > curr.signal!) {
      return { signal: "buy", label: "MACD > シグナル（上昇傾向）" };
    }
    return { signal: "sell", label: "MACD < シグナル（下降傾向）" };
  })();

  const lastRsi = rsiData.filter(d => d.rsi != null);
  const rsiValue = lastRsi.length > 0 ? lastRsi[lastRsi.length - 1].rsi : null;
  const rsiSignal: SignalSummary["rsi"] = (() => {
    if (rsiValue == null) return { signal: "neutral", label: "データ不足", value: null };
    if (rsiValue >= 70) return { signal: "sell", label: "買われすぎ（売り）", value: rsiValue };
    if (rsiValue <= 30) return { signal: "buy", label: "売られすぎ（買い）", value: rsiValue };
    return { signal: "neutral", label: "中立圏", value: rsiValue };
  })();

  const lastMa = maData.filter(d => d.ma5 != null && d.ma25 != null);
  const maSignal: SignalSummary["ma"] = (() => {
    if (lastMa.length < 2) return { signal: "neutral", label: "データ不足" };
    const curr = lastMa[lastMa.length - 1];
    const prev = lastMa[lastMa.length - 2];
    if (prev.ma5! <= prev.ma25! && curr.ma5! > curr.ma25!) {
      return { signal: "buy", label: "ゴールデンクロス（買い）" };
    }
    if (prev.ma5! >= prev.ma25! && curr.ma5! < curr.ma25!) {
      return { signal: "sell", label: "デッドクロス（売り）" };
    }
    if (curr.close > curr.ma5! && curr.ma5! > curr.ma25!) {
      return { signal: "buy", label: "上昇トレンド" };
    }
    if (curr.close < curr.ma5! && curr.ma5! < curr.ma25!) {
      return { signal: "sell", label: "下降トレンド" };
    }
    return { signal: "neutral", label: "方向感なし" };
  })();

  const lastBb = bbData.filter(d => d.upper != null);
  const bbSignal: SignalSummary["bollinger"] = (() => {
    if (lastBb.length === 0) return { signal: "neutral", label: "データ不足" };
    const curr = lastBb[lastBb.length - 1];
    if (curr.close >= curr.upper!) return { signal: "sell", label: "上限バンド到達（売り）" };
    if (curr.close <= curr.lower!) return { signal: "buy", label: "下限バンド到達（買い）" };
    return { signal: "neutral", label: "バンド内推移" };
  })();

  const signals = [macdSignal.signal, rsiSignal.signal, maSignal.signal, bbSignal.signal];
  const buyCount = signals.filter(s => s === "buy").length;
  const sellCount = signals.filter(s => s === "sell").length;

  const overall: SignalSummary["overall"] = (() => {
    if (buyCount >= 3) return { signal: "buy", label: "強い買いシグナル" };
    if (sellCount >= 3) return { signal: "sell", label: "強い売りシグナル" };
    if (buyCount > sellCount) return { signal: "buy", label: "やや買い優勢" };
    if (sellCount > buyCount) return { signal: "sell", label: "やや売り優勢" };
    return { signal: "neutral", label: "様子見" };
  })();

  return { macd: macdSignal, rsi: rsiSignal, ma: maSignal, bollinger: bbSignal, overall };
}
