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
      const symbol = encodeURIComponent(`${ticker}.T`);
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!res.ok) continue;

      const data = await res.json();
      const meta = data.chart?.result?.[0]?.meta;
      if (!meta) continue;

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
        updated++;
      }

      await new Promise(r => setTimeout(r, 200));
    } catch {
    }
  }

  return updated;
}
