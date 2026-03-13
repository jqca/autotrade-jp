import { storage } from "./storage";

export const KABU_DEFAULT_BASE = "http://localhost:18080";

let _cachedToken: string | null = null;
let _tokenExpiry = 0;

export function clearKabuTokenCache() {
  _cachedToken = null;
  _tokenExpiry = 0;
}

export async function getKabuBaseUrl(): Promise<string> {
  try {
    const setting = await storage.getAppSetting("kabu_api_base_url");
    return (setting?.value || process.env.KABU_API_BASE_URL || KABU_DEFAULT_BASE).replace(/\/$/, "");
  } catch {
    return process.env.KABU_API_BASE_URL || KABU_DEFAULT_BASE;
  }
}

export async function getKabuToken(password?: string): Promise<string> {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiry) return _cachedToken;

  const baseUrl = await getKabuBaseUrl();
  const apiPassword = password || process.env.KABU_API_PASSWORD || "";
  if (!apiPassword) throw new Error("kabu APIパスワードが設定されていません");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/kabusapi/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ APIPassword: apiPassword }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`認証失敗 (${res.status}): ${text}`);
    }
    const data = await res.json();
    _cachedToken = data.Token;
    _tokenExpiry = now + 55 * 60 * 1000;
    return _cachedToken!;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("接続タイムアウト: kabuステーション® が起動していますか？");
    throw err;
  }
}

export async function kabuFetch(method: string, path: string, body?: unknown, password?: string): Promise<unknown> {
  const baseUrl = await getKabuBaseUrl();
  const token = await getKabuToken(password);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/kabusapi${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": token,
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text();
    if (!res.ok) throw new Error(`kabu API エラー (${res.status}): ${text}`);
    return text ? JSON.parse(text) : {};
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("接続タイムアウト");
    throw err;
  }
}

export async function checkKabuConnection(): Promise<{ connected: boolean; baseUrl: string; error?: string }> {
  const baseUrl = await getKabuBaseUrl();
  try {
    await getKabuToken();
    return { connected: true, baseUrl };
  } catch (err: any) {
    return { connected: false, baseUrl, error: err.message };
  }
}

export function parseKabuSide(side: string): string {
  return side === "2" ? "買" : side === "1" ? "売" : side;
}

export function parseKabuOrderType(type: number): string {
  if (type === 10) return "成行";
  if (type === 20) return "指値";
  if (type === 21) return "逆指値";
  return String(type);
}

export function parseKabuOrderStatus(status: number): string {
  const map: Record<number, string> = {
    1: "待機中", 2: "処理中", 3: "処理済", 4: "訂正取消送信済",
    5: "受付済", 6: "失効", 7: "取消済", 8: "未送信", 9: "部分約定",
  };
  return map[status] ?? String(status);
}

export function parseKabuExchange(exchange: number): string {
  const map: Record<number, string> = { 1: "東証", 3: "名証", 5: "福証", 6: "札証" };
  return map[exchange] ?? String(exchange);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface FillResult {
  filled: boolean;
  partialFilled: boolean;
  fillPrice: number | null;
  fillQty: number;
  orderQty: number;
  state: number;
  stateLabel: string;
  timedOut: boolean;
  cancelled: boolean;
}

/**
 * 発注後に約定を確認するポーリングループ
 * kabu station® GET /orders?product=0 を定期的に照会し、
 * 約定完了・失効・取消・タイムアウトのいずれかになるまで待機する
 *
 * State:
 *   1=待機中, 2=処理中, 3=処理済(全数約定),
 *   4=訂正取消送信済, 5=受付済, 6=失効, 7=取消済,
 *   8=未送信, 9=部分約定
 */
export async function waitForFill(
  orderId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<FillResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const orders = await kabuFetch("GET", "/orders?product=0") as any[];
      const order = Array.isArray(orders) ? orders.find((o: any) => o.ID === orderId) : null;

      if (order) {
        const state: number = order.State ?? 0;
        const orderQty: number = order.OrderQty ?? 0;
        const cumQty: number = order.CumQty ?? 0;

        // Detailsから加重平均約定価格を計算
        let totalValue = 0;
        let totalQty = 0;
        if (Array.isArray(order.Details)) {
          for (const d of order.Details) {
            if (d.ExecType === "Filled" && typeof d.Price === "number" && d.Price > 0 && d.Qty > 0) {
              totalValue += d.Price * d.Qty;
              totalQty += d.Qty;
            }
          }
        }
        // フォールバック: Detailsがない場合はOrderのPrice（成行では0のことが多い）
        const fillPrice = totalQty > 0
          ? Math.round((totalValue / totalQty) * 100) / 100
          : (typeof order.Price === "number" && order.Price > 0 ? order.Price : null);

        // 全数約定 (state=3=処理済, または CumQty >= OrderQty)
        if (state === 3 || (cumQty > 0 && orderQty > 0 && cumQty >= orderQty)) {
          return {
            filled: true, partialFilled: false,
            fillPrice, fillQty: cumQty || totalQty, orderQty,
            state, stateLabel: parseKabuOrderStatus(state),
            timedOut: false, cancelled: false,
          };
        }

        // 失効・取消
        if (state === 6 || state === 7) {
          return {
            filled: false, partialFilled: cumQty > 0,
            fillPrice: cumQty > 0 ? fillPrice : null,
            fillQty: cumQty, orderQty,
            state, stateLabel: parseKabuOrderStatus(state),
            timedOut: false, cancelled: true,
          };
        }

        // 部分約定中：デッドライン間際なら部分約定として返す
        if (state === 9 && cumQty > 0 && Date.now() + pollIntervalMs > deadline) {
          return {
            filled: false, partialFilled: true,
            fillPrice, fillQty: cumQty, orderQty,
            state, stateLabel: parseKabuOrderStatus(state),
            timedOut: false, cancelled: false,
          };
        }
      }
    } catch {
      // 一時的なエラーはスキップしてリトライ
    }

    await sleep(pollIntervalMs);
  }

  // タイムアウト
  return {
    filled: false, partialFilled: false,
    fillPrice: null, fillQty: 0, orderQty: 0,
    state: 0, stateLabel: "タイムアウト",
    timedOut: true, cancelled: false,
  };
}
