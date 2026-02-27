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

async function fetchSinglePrice(ticker: string): Promise<number> {
  const symbol = encodeURIComponent(`${ticker}.T`);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;

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
