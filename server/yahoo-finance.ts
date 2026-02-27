export interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchHistoricalPrices(
  ticker: string,
  range: string = "6mo",
  interval: string = "1d"
): Promise<HistoricalPrice[]> {
  if (!/^[0-9A-Za-z]{4}$/.test(ticker)) {
    throw new Error("Invalid ticker format. Expected 4-character TSE code.");
  }
  const symbol = encodeURIComponent(`${ticker}.T`);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance API error: ${res.status}`);
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];

  if (!result) {
    throw new Error("No data returned from Yahoo Finance");
  }

  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];

  if (!quote) {
    throw new Error("No quote data available");
  }

  const prices: HistoricalPrice[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];

    if (open != null && high != null && low != null && close != null) {
      const date = new Date(timestamps[i] * 1000);
      prices.push({
        date: date.toISOString().split("T")[0],
        open: Math.round(open * 10) / 10,
        high: Math.round(high * 10) / 10,
        low: Math.round(low * 10) / 10,
        close: Math.round(close * 10) / 10,
        volume: volume || 0,
      });
    }
  }

  return prices;
}
