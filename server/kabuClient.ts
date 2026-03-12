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
