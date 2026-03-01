import XLSX from "xlsx";
import { storage } from "./storage";
import type { InsertStock } from "@shared/schema";

const JPX_URL = "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls";

const SECTOR_MAP: Record<string, string> = {
  "水産・農林業": "水産・農林業",
  "鉱業": "鉱業",
  "建設業": "建設業",
  "食料品": "食料品",
  "繊維製品": "繊維製品",
  "パルプ・紙": "パルプ・紙",
  "化学": "化学",
  "医薬品": "医薬品",
  "石油・石炭製品": "石油・石炭製品",
  "ゴム製品": "ゴム製品",
  "ガラス・土石製品": "ガラス・土石製品",
  "鉄鋼": "鉄鋼",
  "非鉄金属": "非鉄金属",
  "金属製品": "金属製品",
  "機械": "機械",
  "電気機器": "電気機器",
  "輸送用機器": "輸送用機器",
  "精密機器": "精密機器",
  "その他製品": "その他製品",
  "電気・ガス業": "電気・ガス業",
  "陸運業": "陸運業",
  "海運業": "海運業",
  "空運業": "空運業",
  "倉庫・運輸関連業": "倉庫・運輸関連業",
  "情報・通信業": "情報・通信業",
  "卸売業": "卸売業",
  "小売業": "小売業",
  "銀行業": "銀行業",
  "証券、商品先物取引業": "証券・先物取引",
  "保険業": "保険業",
  "その他金融業": "その他金融業",
  "不動産業": "不動産業",
  "サービス業": "サービス業",
};

export async function importJPXStocks(): Promise<{ imported: number; total: number }> {
  console.log("Downloading JPX stock list...");

  const res = await fetch(JPX_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download JPX list: ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const stockList: InsertStock[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[1] || !row[2]) continue;
    const code = String(row[1]).trim();
    const name = String(row[2]).trim();
    const market = String(row[3] || "");
    const sector33 = String(row[5] || "");

    if (!market.includes("内国株式")) continue;
    if (!code || !name) continue;
    if (!/^[0-9A-Za-z]{4}$/.test(code)) continue;

    const sector = SECTOR_MAP[sector33] || sector33 || "その他";

    stockList.push({
      ticker: code,
      name,
      sector,
      currentPrice: 0,
      previousClose: 0,
      dayHigh: 0,
      dayLow: 0,
      volume: 0,
      isWatched: false,
    });
  }

  console.log(`Parsed ${stockList.length} domestic stocks from JPX list`);

  const imported = await storage.bulkUpsertStocks(stockList);
  console.log(`Imported ${imported} stocks into database`);

  return { imported, total: stockList.length };
}

export async function fetchBatchPrices(tickers: string[]): Promise<number> {
  let updated = 0;

  for (const ticker of tickers) {
    try {
      updated += await fetchSinglePrice(ticker);
      await new Promise(r => setTimeout(r, 150));
    } catch {
    }
  }

  return updated;
}

function tickerToSymbol(ticker: string): string {
  if (/^[0-9]{4}$/.test(ticker)) return `${ticker}.T`;
  return ticker;
}

async function fetchSinglePrice(ticker: string): Promise<number> {
  const symbol = encodeURIComponent(tickerToSymbol(ticker));
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) return 0;

  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return 0;

  const currentPrice = meta.regularMarketPrice || 0;
  const previousClose = meta.chartPreviousClose || meta.previousClose || 0;
  const dayHigh = meta.regularMarketDayHigh || currentPrice;
  const dayLow = meta.regularMarketDayLow || currentPrice;
  const volume = meta.regularMarketVolume || 0;

  if (currentPrice > 0) {
    await storage.updateStockPrice(ticker, currentPrice, dayHigh, dayLow, volume);
    if (previousClose > 0) {
      await storage.updatePreviousClose(ticker, previousClose);
    }

    const fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh || null;
    const fiftyTwoWeekLow = meta.fiftyTwoWeekLow || null;

    if (fiftyTwoWeekHigh || fiftyTwoWeekLow) {
      await storage.updateStockFundamentals(ticker, {
        fiftyTwoWeekHigh,
        fiftyTwoWeekLow,
      });
    }

    return 1;
  }
  return 0;
}

export interface FetchAllProgress {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  updated: number;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string;
}

const progress: FetchAllProgress = {
  status: "idle",
  total: 0,
  processed: 0,
  updated: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
  message: "",
};

export function getFetchAllProgress(): FetchAllProgress {
  return { ...progress };
}

export async function startFetchAllPrices(concurrency: number = 3, onComplete?: () => void): Promise<void> {
  if (progress.status === "running") {
    throw new Error("Already running");
  }

  const tickers = await storage.getAllStockTickers();

  progress.status = "running";
  progress.total = tickers.length;
  progress.processed = 0;
  progress.updated = 0;
  progress.errors = 0;
  progress.startedAt = Date.now();
  progress.completedAt = null;
  progress.message = "株価取得を開始しました...";

  (async () => {
    try {
      for (let i = 0; i < tickers.length; i += concurrency) {
        const batch = tickers.slice(i, i + concurrency);

        const results = await Promise.allSettled(
          batch.map(async (ticker) => {
            try {
              const result = await fetchSinglePrice(ticker);
              return result;
            } catch {
              return 0;
            }
          })
        );

        for (const r of results) {
          progress.processed++;
          if (r.status === "fulfilled" && r.value > 0) {
            progress.updated++;
          } else if (r.status === "rejected") {
            progress.errors++;
          }
        }

        progress.message = `${progress.processed}/${progress.total} 処理済み (${progress.updated}件取得成功)`;

        if (i + concurrency < tickers.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      progress.status = "completed";
      progress.completedAt = Date.now();
      const elapsed = Math.round((progress.completedAt - progress.startedAt!) / 1000);
      progress.message = `完了: ${progress.updated}/${progress.total}件の株価を取得 (${elapsed}秒)`;
      console.log(progress.message);

      if (onComplete) {
        onComplete();
      }
    } catch (err: any) {
      progress.status = "error";
      progress.completedAt = Date.now();
      progress.message = `エラー: ${err.message}`;
      console.error("Fetch all prices error:", err);

      if (onComplete && progress.updated > 0) {
        onComplete();
      }
    }
  })();
}

function classifyMarketCap(marketCap: number | null | undefined): string | null {
  if (!marketCap) return null;
  const oku = marketCap / 100000000;
  if (oku >= 10000) return "大型 (1兆円以上)";
  if (oku >= 3000) return "中大型 (3000億〜1兆円)";
  if (oku >= 1000) return "中型 (1000億〜3000億円)";
  if (oku >= 300) return "小型 (300億〜1000億円)";
  if (oku >= 100) return "小型 (100億〜300億円)";
  return "マイクロ (100億円未満)";
}

export interface FundamentalsFetchProgress {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  updated: number;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string;
}

const fundamentalsProgress: FundamentalsFetchProgress = {
  status: "idle", total: 0, processed: 0, updated: 0, errors: 0,
  startedAt: null, completedAt: null, message: "",
};

export function getFundamentalsFetchProgress(): FundamentalsFetchProgress {
  return { ...fundamentalsProgress };
}

async function fetchSingleFundamentals(ticker: string): Promise<number> {
  const symbol = encodeURIComponent(tickerToSymbol(ticker));
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) return 0;

  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return 0;

  const currentPrice = meta.regularMarketPrice;
  if (!currentPrice || currentPrice <= 0) return 0;

  const fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh || null;
  const fiftyTwoWeekLow = meta.fiftyTwoWeekLow || null;

  let marketCap: number | null = null;
  let sharesOutstanding: number | null = null;
  if (meta.regularMarketVolume && fiftyTwoWeekHigh) {
    try {
      const summaryUrl = `https://query2.finance.yahoo.com/v6/finance/quote?symbols=${symbol}`;
      const summaryRes = await fetch(summaryUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        const quote = summaryData.quoteResponse?.result?.[0];
        if (quote) {
          marketCap = quote.marketCap || null;
          sharesOutstanding = quote.sharesOutstanding || null;
        }
      }
    } catch {}
  }

  const marketCapCategory = classifyMarketCap(marketCap);

  await storage.updateStockFundamentals(ticker, {
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    marketCap,
    sharesOutstanding,
    unitShares: 100,
    marketCapCategory,
  });

  return 1;
}

export async function startFetchFundamentals(concurrency: number = 3): Promise<void> {
  if (fundamentalsProgress.status === "running") {
    throw new Error("Already running");
  }

  const tickers = await storage.getAllStockTickers();

  fundamentalsProgress.status = "running";
  fundamentalsProgress.total = tickers.length;
  fundamentalsProgress.processed = 0;
  fundamentalsProgress.updated = 0;
  fundamentalsProgress.errors = 0;
  fundamentalsProgress.startedAt = Date.now();
  fundamentalsProgress.completedAt = null;
  fundamentalsProgress.message = "ファンダメンタル情報取得を開始...";

  (async () => {
    try {
      for (let i = 0; i < tickers.length; i += concurrency) {
        const batch = tickers.slice(i, i + concurrency);

        const results = await Promise.allSettled(
          batch.map(async (ticker) => {
            try {
              return await fetchSingleFundamentals(ticker);
            } catch {
              return 0;
            }
          })
        );

        for (const r of results) {
          fundamentalsProgress.processed++;
          if (r.status === "fulfilled" && r.value > 0) {
            fundamentalsProgress.updated++;
          } else if (r.status === "rejected") {
            fundamentalsProgress.errors++;
          }
        }

        fundamentalsProgress.message = `${fundamentalsProgress.processed}/${fundamentalsProgress.total} 処理済み (${fundamentalsProgress.updated}件取得)`;

        if (i + concurrency < tickers.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      fundamentalsProgress.status = "completed";
      fundamentalsProgress.completedAt = Date.now();
      const elapsed = Math.round((fundamentalsProgress.completedAt - fundamentalsProgress.startedAt!) / 1000);
      fundamentalsProgress.message = `完了: ${fundamentalsProgress.updated}/${fundamentalsProgress.total}件のファンダメンタル情報を取得 (${elapsed}秒)`;
      console.log(fundamentalsProgress.message);
    } catch (err: any) {
      fundamentalsProgress.status = "error";
      fundamentalsProgress.completedAt = Date.now();
      fundamentalsProgress.message = `エラー: ${err.message}`;
      console.error("Fetch fundamentals error:", err);
    }
  })();
}

const US_STOCKS: { ticker: string; name: string; sector: string }[] = [
  { ticker: "AAPL", name: "Apple", sector: "Technology" },
  { ticker: "MSFT", name: "Microsoft", sector: "Technology" },
  { ticker: "GOOGL", name: "Alphabet (Google)", sector: "Technology" },
  { ticker: "AMZN", name: "Amazon", sector: "Consumer Cyclical" },
  { ticker: "NVDA", name: "NVIDIA", sector: "Technology" },
  { ticker: "META", name: "Meta Platforms", sector: "Technology" },
  { ticker: "TSLA", name: "Tesla", sector: "Consumer Cyclical" },
  { ticker: "BRK-B", name: "Berkshire Hathaway B", sector: "Financial Services" },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Financial Services" },
  { ticker: "V", name: "Visa", sector: "Financial Services" },
  { ticker: "UNH", name: "UnitedHealth Group", sector: "Healthcare" },
  { ticker: "MA", name: "Mastercard", sector: "Financial Services" },
  { ticker: "JNJ", name: "Johnson & Johnson", sector: "Healthcare" },
  { ticker: "XOM", name: "Exxon Mobil", sector: "Energy" },
  { ticker: "PG", name: "Procter & Gamble", sector: "Consumer Defensive" },
  { ticker: "HD", name: "Home Depot", sector: "Consumer Cyclical" },
  { ticker: "AVGO", name: "Broadcom", sector: "Technology" },
  { ticker: "CVX", name: "Chevron", sector: "Energy" },
  { ticker: "MRK", name: "Merck", sector: "Healthcare" },
  { ticker: "ABBV", name: "AbbVie", sector: "Healthcare" },
  { ticker: "KO", name: "Coca-Cola", sector: "Consumer Defensive" },
  { ticker: "PEP", name: "PepsiCo", sector: "Consumer Defensive" },
  { ticker: "COST", name: "Costco", sector: "Consumer Defensive" },
  { ticker: "LLY", name: "Eli Lilly", sector: "Healthcare" },
  { ticker: "WMT", name: "Walmart", sector: "Consumer Defensive" },
  { ticker: "TMO", name: "Thermo Fisher Scientific", sector: "Healthcare" },
  { ticker: "BAC", name: "Bank of America", sector: "Financial Services" },
  { ticker: "CSCO", name: "Cisco Systems", sector: "Technology" },
  { ticker: "CRM", name: "Salesforce", sector: "Technology" },
  { ticker: "ABT", name: "Abbott Laboratories", sector: "Healthcare" },
  { ticker: "ACN", name: "Accenture", sector: "Technology" },
  { ticker: "MCD", name: "McDonald's", sector: "Consumer Cyclical" },
  { ticker: "NFLX", name: "Netflix", sector: "Communication Services" },
  { ticker: "AMD", name: "AMD", sector: "Technology" },
  { ticker: "LIN", name: "Linde", sector: "Basic Materials" },
  { ticker: "ADBE", name: "Adobe", sector: "Technology" },
  { ticker: "TXN", name: "Texas Instruments", sector: "Technology" },
  { ticker: "ORCL", name: "Oracle", sector: "Technology" },
  { ticker: "PM", name: "Philip Morris", sector: "Consumer Defensive" },
  { ticker: "QCOM", name: "Qualcomm", sector: "Technology" },
  { ticker: "DIS", name: "Walt Disney", sector: "Communication Services" },
  { ticker: "INTC", name: "Intel", sector: "Technology" },
  { ticker: "INTU", name: "Intuit", sector: "Technology" },
  { ticker: "AMGN", name: "Amgen", sector: "Healthcare" },
  { ticker: "WFC", name: "Wells Fargo", sector: "Financial Services" },
  { ticker: "IBM", name: "IBM", sector: "Technology" },
  { ticker: "CAT", name: "Caterpillar", sector: "Industrials" },
  { ticker: "GE", name: "GE Aerospace", sector: "Industrials" },
  { ticker: "BA", name: "Boeing", sector: "Industrials" },
  { ticker: "AXP", name: "American Express", sector: "Financial Services" },
  { ticker: "GS", name: "Goldman Sachs", sector: "Financial Services" },
  { ticker: "NOW", name: "ServiceNow", sector: "Technology" },
  { ticker: "ISRG", name: "Intuitive Surgical", sector: "Healthcare" },
  { ticker: "AMAT", name: "Applied Materials", sector: "Technology" },
  { ticker: "BKNG", name: "Booking Holdings", sector: "Consumer Cyclical" },
  { ticker: "SPGI", name: "S&P Global", sector: "Financial Services" },
  { ticker: "MDT", name: "Medtronic", sector: "Healthcare" },
  { ticker: "BLK", name: "BlackRock", sector: "Financial Services" },
  { ticker: "DE", name: "Deere & Company", sector: "Industrials" },
  { ticker: "GILD", name: "Gilead Sciences", sector: "Healthcare" },
  { ticker: "SYK", name: "Stryker", sector: "Healthcare" },
  { ticker: "VRTX", name: "Vertex Pharmaceuticals", sector: "Healthcare" },
  { ticker: "ADP", name: "ADP", sector: "Industrials" },
  { ticker: "MMM", name: "3M", sector: "Industrials" },
  { ticker: "T", name: "AT&T", sector: "Communication Services" },
  { ticker: "VZ", name: "Verizon", sector: "Communication Services" },
  { ticker: "PFE", name: "Pfizer", sector: "Healthcare" },
  { ticker: "NKE", name: "Nike", sector: "Consumer Cyclical" },
  { ticker: "UPS", name: "United Parcel Service", sector: "Industrials" },
  { ticker: "LOW", name: "Lowe's", sector: "Consumer Cyclical" },
  { ticker: "MS", name: "Morgan Stanley", sector: "Financial Services" },
  { ticker: "SCHW", name: "Charles Schwab", sector: "Financial Services" },
  { ticker: "RTX", name: "RTX (Raytheon)", sector: "Industrials" },
  { ticker: "LMT", name: "Lockheed Martin", sector: "Industrials" },
  { ticker: "NEE", name: "NextEra Energy", sector: "Utilities" },
  { ticker: "SBUX", name: "Starbucks", sector: "Consumer Cyclical" },
  { ticker: "MDLZ", name: "Mondelez", sector: "Consumer Defensive" },
  { ticker: "C", name: "Citigroup", sector: "Financial Services" },
  { ticker: "SO", name: "Southern Company", sector: "Utilities" },
  { ticker: "DUK", name: "Duke Energy", sector: "Utilities" },
  { ticker: "BMY", name: "Bristol-Myers Squibb", sector: "Healthcare" },
  { ticker: "ZTS", name: "Zoetis", sector: "Healthcare" },
  { ticker: "CI", name: "Cigna Group", sector: "Healthcare" },
  { ticker: "CB", name: "Chubb", sector: "Financial Services" },
  { ticker: "CME", name: "CME Group", sector: "Financial Services" },
  { ticker: "CL", name: "Colgate-Palmolive", sector: "Consumer Defensive" },
  { ticker: "MO", name: "Altria Group", sector: "Consumer Defensive" },
  { ticker: "REGN", name: "Regeneron", sector: "Healthcare" },
  { ticker: "FDX", name: "FedEx", sector: "Industrials" },
  { ticker: "ITW", name: "Illinois Tool Works", sector: "Industrials" },
  { ticker: "PYPL", name: "PayPal", sector: "Financial Services" },
  { ticker: "SQ", name: "Block (Square)", sector: "Technology" },
  { ticker: "SHOP", name: "Shopify", sector: "Technology" },
  { ticker: "ABNB", name: "Airbnb", sector: "Consumer Cyclical" },
  { ticker: "UBER", name: "Uber", sector: "Technology" },
  { ticker: "SNAP", name: "Snap", sector: "Communication Services" },
  { ticker: "COIN", name: "Coinbase", sector: "Financial Services" },
  { ticker: "PLTR", name: "Palantir Technologies", sector: "Technology" },
  { ticker: "CRWD", name: "CrowdStrike", sector: "Technology" },
  { ticker: "SNOW", name: "Snowflake", sector: "Technology" },
  { ticker: "DDOG", name: "Datadog", sector: "Technology" },
  { ticker: "NET", name: "Cloudflare", sector: "Technology" },
  { ticker: "ZS", name: "Zscaler", sector: "Technology" },
  { ticker: "PANW", name: "Palo Alto Networks", sector: "Technology" },
  { ticker: "MELI", name: "MercadoLibre", sector: "Consumer Cyclical" },
  { ticker: "SE", name: "Sea Limited", sector: "Technology" },
  { ticker: "RIVN", name: "Rivian", sector: "Consumer Cyclical" },
  { ticker: "LCID", name: "Lucid Group", sector: "Consumer Cyclical" },
  { ticker: "F", name: "Ford Motor", sector: "Consumer Cyclical" },
  { ticker: "GM", name: "General Motors", sector: "Consumer Cyclical" },
  { ticker: "AAL", name: "American Airlines", sector: "Industrials" },
  { ticker: "DAL", name: "Delta Air Lines", sector: "Industrials" },
  { ticker: "UAL", name: "United Airlines", sector: "Industrials" },
  { ticker: "CCL", name: "Carnival", sector: "Consumer Cyclical" },
  { ticker: "WDAY", name: "Workday", sector: "Technology" },
  { ticker: "TEAM", name: "Atlassian", sector: "Technology" },
  { ticker: "MRVL", name: "Marvell Technology", sector: "Technology" },
  { ticker: "MU", name: "Micron Technology", sector: "Technology" },
  { ticker: "LRCX", name: "Lam Research", sector: "Technology" },
  { ticker: "KLAC", name: "KLA Corporation", sector: "Technology" },
  { ticker: "ON", name: "ON Semiconductor", sector: "Technology" },
  { ticker: "SMCI", name: "Super Micro Computer", sector: "Technology" },
  { ticker: "ARM", name: "Arm Holdings", sector: "Technology" },
  { ticker: "TSM", name: "TSMC (ADR)", sector: "Technology" },
  { ticker: "ASML", name: "ASML Holding (ADR)", sector: "Technology" },
  { ticker: "BABA", name: "Alibaba (ADR)", sector: "Consumer Cyclical" },
  { ticker: "NIO", name: "NIO (ADR)", sector: "Consumer Cyclical" },
  { ticker: "PDD", name: "PDD Holdings (ADR)", sector: "Consumer Cyclical" },
  { ticker: "JD", name: "JD.com (ADR)", sector: "Consumer Cyclical" },
  { ticker: "SONY", name: "Sony Group (ADR)", sector: "Technology" },
  { ticker: "TM", name: "Toyota Motor (ADR)", sector: "Consumer Cyclical" },
  { ticker: "NVO", name: "Novo Nordisk (ADR)", sector: "Healthcare" },
  { ticker: "LI", name: "Li Auto (ADR)", sector: "Consumer Cyclical" },
];

export async function importUSStocks(): Promise<{ imported: number; total: number }> {
  console.log("Importing US stock list...");

  const stockList: InsertStock[] = US_STOCKS.map(s => ({
    ticker: s.ticker,
    name: s.name,
    sector: s.sector,
    market: "US",
    currentPrice: 0,
    previousClose: 0,
    dayHigh: 0,
    dayLow: 0,
    volume: 0,
    isWatched: false,
    unitShares: 1,
  }));

  console.log(`Importing ${stockList.length} US stocks...`);
  const imported = await storage.bulkUpsertStocks(stockList);
  console.log(`Imported ${imported} US stocks into database`);

  return { imported, total: stockList.length };
}

export interface USFetchProgress {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  updated: number;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string;
}

const usFetchProgress: USFetchProgress = {
  status: "idle", total: 0, processed: 0, updated: 0, errors: 0,
  startedAt: null, completedAt: null, message: "",
};

export function getUSFetchProgress(): USFetchProgress {
  return { ...usFetchProgress };
}

export async function startFetchUSPrices(concurrency: number = 3): Promise<void> {
  if (usFetchProgress.status === "running") {
    throw new Error("Already running");
  }

  const usTickers = await storage.getAllStockTickers("US");

  if (usTickers.length === 0) {
    throw new Error("米国株が登録されていません。先にインポートしてください。");
  }

  usFetchProgress.status = "running";
  usFetchProgress.total = usTickers.length;
  usFetchProgress.processed = 0;
  usFetchProgress.updated = 0;
  usFetchProgress.errors = 0;
  usFetchProgress.startedAt = Date.now();
  usFetchProgress.completedAt = null;
  usFetchProgress.message = "米国株価取得を開始しました...";

  (async () => {
    try {
      for (let i = 0; i < usTickers.length; i += concurrency) {
        const batch = usTickers.slice(i, i + concurrency);

        const results = await Promise.allSettled(
          batch.map(async (ticker) => {
            try {
              return await fetchSinglePrice(ticker);
            } catch {
              return 0;
            }
          })
        );

        for (const r of results) {
          usFetchProgress.processed++;
          if (r.status === "fulfilled" && r.value > 0) {
            usFetchProgress.updated++;
          } else if (r.status === "rejected") {
            usFetchProgress.errors++;
          }
        }

        usFetchProgress.message = `${usFetchProgress.processed}/${usFetchProgress.total} 処理済み (${usFetchProgress.updated}件取得成功)`;

        if (i + concurrency < usTickers.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      usFetchProgress.status = "completed";
      usFetchProgress.completedAt = Date.now();
      const elapsed = Math.round((usFetchProgress.completedAt - usFetchProgress.startedAt!) / 1000);
      usFetchProgress.message = `完了: ${usFetchProgress.updated}/${usFetchProgress.total}件の米国株価を取得 (${elapsed}秒)`;
      console.log(usFetchProgress.message);
    } catch (err: any) {
      usFetchProgress.status = "error";
      usFetchProgress.completedAt = Date.now();
      usFetchProgress.message = `エラー: ${err.message}`;
      console.error("Fetch US prices error:", err);
    }
  })();
}
