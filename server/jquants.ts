import type { HistoricalPrice } from "./yahoo-finance";

const BASE_URL = "https://api.jquants.com/v2";

function getApiKey(): string {
  const key = process.env.JQUANTS_API_KEY;
  if (!key) throw new Error("JQUANTS_API_KEY が設定されていません");
  return key;
}

function toJQuantsCode(ticker: string): string {
  return ticker.length === 4 ? ticker + "0" : ticker;
}

function formatDateJST(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

interface JQuantsBar {
  Date: string;
  Code: string;
  O: number;
  H: number;
  L: number;
  C: number;
  Vo: number;
  Va: number;
  AdjFactor: number;
  AdjO: number;
  AdjH: number;
  AdjL: number;
  AdjC: number;
  AdjVo: number;
}

interface JQuantsDailyResponse {
  data: JQuantsBar[];
  pagination_key?: string;
}

async function jquantsFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { "x-api-key": getApiKey() },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`J-Quants API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

function normalizeDate(d: string): string {
  return d.includes("-") ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export async function fetchJQuantsDailyPrices(
  ticker: string,
  from: Date,
  to: Date
): Promise<HistoricalPrice[]> {
  const code = toJQuantsCode(ticker);
  const allBars: JQuantsBar[] = [];
  let paginationKey: string | undefined;

  do {
    const params: Record<string, string> = {
      code,
      from: formatDateJST(from),
      to: formatDateJST(to),
    };
    if (paginationKey) params.pagination_key = paginationKey;

    const data = await jquantsFetch<JQuantsDailyResponse>("/equities/bars/daily", params);
    if (data.data) allBars.push(...data.data);
    paginationKey = data.pagination_key;
  } while (paginationKey);

  allBars.sort((a, b) => normalizeDate(a.Date).localeCompare(normalizeDate(b.Date)));

  return allBars
    .filter(b => b.AdjO != null && b.AdjH != null && b.AdjL != null && b.AdjC != null)
    .map(b => ({
      date: normalizeDate(b.Date),
      open: Math.round(b.AdjO * 10) / 10,
      high: Math.round(b.AdjH * 10) / 10,
      low: Math.round(b.AdjL * 10) / 10,
      close: Math.round(b.AdjC * 10) / 10,
      volume: b.AdjVo || 0,
    }));
}

export async function fetchJQuantsLatestPrices(
  tickers: string[]
): Promise<Map<string, { price: number; high: number; low: number; volume: number; previousClose: number }>> {
  const result = new Map<string, { price: number; high: number; low: number; volume: number; previousClose: number }>();

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 10);

  for (const ticker of tickers) {
    try {
      const bars = await fetchJQuantsDailyPrices(ticker, from, today);
      if (bars.length === 0) continue;

      const latest = bars[bars.length - 1];
      const prev = bars.length >= 2 ? bars[bars.length - 2] : latest;

      result.set(ticker, {
        price: latest.close,
        high: latest.high,
        low: latest.low,
        volume: latest.volume,
        previousClose: prev.close,
      });
    } catch {
    }
  }

  return result;
}

export async function fetchJQuantsHistorical(
  ticker: string,
  range: string = "6mo"
): Promise<HistoricalPrice[]> {
  const to = new Date();
  const from = new Date();

  switch (range) {
    case "1mo": from.setMonth(from.getMonth() - 1); break;
    case "3mo": from.setMonth(from.getMonth() - 3); break;
    case "6mo": from.setMonth(from.getMonth() - 6); break;
    case "1y": from.setFullYear(from.getFullYear() - 1); break;
    case "2y": from.setFullYear(from.getFullYear() - 2); break;
    case "5y": from.setFullYear(from.getFullYear() - 5); break;
    default: from.setMonth(from.getMonth() - 6); break;
  }

  return fetchJQuantsDailyPrices(ticker, from, to);
}

export function isJQuantsConfigured(): boolean {
  return !!process.env.JQUANTS_API_KEY;
}
