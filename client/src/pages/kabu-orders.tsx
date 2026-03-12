import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Wifi, WifiOff, Settings, RefreshCw, TrendingUp, TrendingDown,
  Send, XCircle, Wallet, List, History, AlertTriangle, ShoppingCart,
  Loader2, CheckCircle, Clock,
} from "lucide-react";
import type { KabuOrder } from "@shared/schema";

interface KabuStatus {
  connected: boolean;
  baseUrl: string;
  error?: string;
}

interface KabuWallet {
  StockAccountWallet?: number;
  AuKabucomRemainingMargin?: number;
}

interface KabuPosition {
  Symbol: string;
  SymbolName?: string;
  Side: string;
  SideLabel: string;
  Qty: number;
  AvgPrice: number;
  CurrentPrice?: number;
  ProfitLoss?: number;
  ProfitLossRate?: number;
  ExchangeLabel: string;
}

interface KabuLiveOrder {
  ID: string;
  Symbol: string;
  SymbolName?: string;
  Side: string;
  SideLabel: string;
  OrderType: number;
  OrderTypeLabel: string;
  State: number;
  StatusLabel: string;
  Qty: number;
  Price: number;
  CumQty: number;
  ExchangeLabel: string;
  RecvTime?: string;
}

const EXCHANGE_OPTIONS = [
  { value: "1", label: "東証（プライム/スタンダード/グロース）" },
  { value: "3", label: "名証" },
  { value: "5", label: "福証" },
  { value: "6", label: "札証" },
];

const ACCOUNT_OPTIONS = [
  { value: "4", label: "特定口座" },
  { value: "2", label: "一般口座" },
  { value: "12", label: "NISA口座" },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "待機", variant: "secondary" },
    sending: { label: "送信中", variant: "secondary" },
    accepted: { label: "受付済", variant: "default" },
    failed: { label: "失敗", variant: "destructive" },
    cancelled: { label: "取消済", variant: "outline" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={variant}>{label}</Badge>;
}

export default function KabuOrdersPage() {
  const { toast } = useToast();
  const [baseUrl, setBaseUrl] = useState("http://localhost:18080");
  const [apiPassword, setApiPassword] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const [symbol, setSymbol] = useState("");
  const [symbolName, setSymbolName] = useState("");
  const [side, setSide] = useState<"2" | "1">("2");
  const [qty, setQty] = useState(100);
  const [price, setPrice] = useState(0);
  const [orderType, setOrderType] = useState<"10" | "20">("10");
  const [exchange, setExchange] = useState("1");
  const [accountType, setAccountType] = useState("4");

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<KabuStatus>({
    queryKey: ["/api/kabu/status"],
    refetchInterval: 30000,
  });

  const { data: wallet, refetch: refetchWallet } = useQuery<KabuWallet>({
    queryKey: ["/api/kabu/wallet"],
    enabled: status?.connected === true,
    refetchInterval: 60000,
  });

  const { data: positions, refetch: refetchPositions } = useQuery<KabuPosition[]>({
    queryKey: ["/api/kabu/positions"],
    enabled: status?.connected === true,
    refetchInterval: 30000,
  });

  const { data: liveOrders, refetch: refetchLiveOrders } = useQuery<KabuLiveOrder[]>({
    queryKey: ["/api/kabu/orders"],
    enabled: status?.connected === true,
    refetchInterval: 15000,
  });

  const { data: history, isLoading: historyLoading } = useQuery<KabuOrder[]>({
    queryKey: ["/api/kabu/history"],
    refetchInterval: 10000,
  });

  const authMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/kabu/auth", { password: apiPassword }),
    onSuccess: () => {
      toast({ title: "認証成功", description: "kabuステーション® APIに接続しました" });
      refetchStatus();
      refetchWallet();
      refetchPositions();
      refetchLiveOrders();
    },
    onError: (err: any) => toast({ title: "認証失敗", description: err.message, variant: "destructive" }),
  });

  const settingsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/kabu/settings", { baseUrl }),
    onSuccess: () => {
      toast({ title: "設定保存", description: "APIエンドポイントを更新しました" });
      setShowSettings(false);
      refetchStatus();
    },
    onError: (err: any) => toast({ title: "エラー", description: err.message, variant: "destructive" }),
  });

  const boardQuery = useMutation({
    mutationFn: (sym: string) => apiRequest("GET", `/api/kabu/board/${sym}?exchange=${exchange}`),
    onSuccess: (data: any) => {
      if (data?.SymbolName) setSymbolName(data.SymbolName);
      if (data?.CurrentPrice) setPrice(data.CurrentPrice);
    },
    onError: () => {},
  });

  const orderMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/kabu/order", {
      symbol,
      symbolName,
      exchange: parseInt(exchange),
      side,
      qty,
      price: orderType === "10" ? 0 : price,
      orderType,
      accountType: parseInt(accountType),
      accountPassword,
    }),
    onSuccess: (data: any) => {
      toast({
        title: "発注完了",
        description: `注文ID: ${data.orderId ?? "受付済"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/kabu/history"] });
      refetchLiveOrders();
    },
    onError: (err: any) => toast({ title: "発注失敗", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => apiRequest("PUT", `/api/kabu/order/${orderId}/cancel`, { accountPassword }),
    onSuccess: () => {
      toast({ title: "取消完了", description: "注文を取り消しました" });
      refetchLiveOrders();
    },
    onError: (err: any) => toast({ title: "取消失敗", description: err.message, variant: "destructive" }),
  });

  const isConnected = status?.connected;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" />
          kabu注文発注
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetchStatus(); refetchWallet(); refetchPositions(); refetchLiveOrders(); }} data-testid="button-refresh-kabu">
            <RefreshCw className="h-3.5 w-3.5 mr-1" />更新
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)} data-testid="button-kabu-settings">
            <Settings className="h-3.5 w-3.5 mr-1" />設定
          </Button>
        </div>
      </div>

      {/* 接続ステータス */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            {statusLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : isConnected ? (
              <Wifi className="h-5 w-5 text-emerald-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-500" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {isConnected ? "接続済み" : "未接続"}
              </p>
              <p className="text-xs text-muted-foreground truncate">{status?.baseUrl || "—"}</p>
              {status?.error && <p className="text-xs text-red-500 mt-0.5">{status.error}</p>}
            </div>
            {wallet?.StockAccountWallet != null && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">現金残高</p>
                <p className="font-bold text-sm">{wallet.StockAccountWallet.toLocaleString("ja-JP")}円</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 設定パネル */}
      {showSettings && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Settings className="h-4 w-4" />kabu API 接続設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">ローカルAPI接続について</p>
                <p className="mt-1">kabuステーション® APIは <strong>PCローカル（localhost:18080）</strong> で動作します。Replit（クラウド）から直接接続するには <strong>ngrok などのトンネルツール</strong> でPCのポートを公開してください。</p>
                <p className="mt-1 font-mono text-xs">ngrok http 18080 → https://xxxx.ngrok.io を下のURLに入力</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm">APIエンドポイントURL</Label>
                <Input
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:18080 または https://xxxx.ngrok.io"
                  data-testid="input-kabu-base-url"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">APIパスワード（kabuステーション® で設定したもの）</Label>
                <Input
                  type="password"
                  value={apiPassword}
                  onChange={e => setApiPassword(e.target.value)}
                  placeholder="APIパスワード"
                  data-testid="input-kabu-api-password"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => settingsMutation.mutate()}
                disabled={settingsMutation.isPending}
                data-testid="button-save-kabu-settings"
              >
                {settingsMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                URLを保存
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => authMutation.mutate()}
                disabled={authMutation.isPending || !apiPassword}
                data-testid="button-kabu-connect"
              >
                {authMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wifi className="h-3.5 w-3.5 mr-1" />}
                接続テスト・認証
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="order">
        <TabsList>
          <TabsTrigger value="order" data-testid="tab-order"><Send className="h-3.5 w-3.5 mr-1" />発注</TabsTrigger>
          <TabsTrigger value="live" data-testid="tab-live-orders"><List className="h-3.5 w-3.5 mr-1" />注文照会</TabsTrigger>
          <TabsTrigger value="positions" data-testid="tab-positions"><Wallet className="h-3.5 w-3.5 mr-1" />保有株</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history"><History className="h-3.5 w-3.5 mr-1" />発注履歴</TabsTrigger>
        </TabsList>

        {/* 発注フォーム */}
        <TabsContent value="order" className="mt-4">
          {!isConnected && (
            <div className="mb-4 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>kabuステーション® に接続していません。上の「設定」から接続してください。</p>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">注文内容</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm">銘柄コード</Label>
                  <div className="flex gap-2">
                    <Input
                      value={symbol}
                      onChange={e => setSymbol(e.target.value)}
                      placeholder="例: 7203"
                      className="font-mono"
                      data-testid="input-symbol"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => symbol && boardQuery.mutate(symbol)}
                      disabled={!symbol || boardQuery.isPending}
                      data-testid="button-fetch-board"
                    >
                      {boardQuery.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "照会"}
                    </Button>
                  </div>
                  {symbolName && <p className="text-xs text-muted-foreground">{symbolName}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">市場</Label>
                  <Select value={exchange} onValueChange={setExchange}>
                    <SelectTrigger data-testid="select-exchange">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXCHANGE_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">売買</Label>
                  <div className="flex gap-2">
                    <Button
                      variant={side === "2" ? "default" : "outline"}
                      className={side === "2" ? "bg-emerald-600 hover:bg-emerald-700 flex-1" : "flex-1"}
                      onClick={() => setSide("2")}
                      data-testid="button-side-buy"
                    >
                      <TrendingUp className="h-4 w-4 mr-1" />買い
                    </Button>
                    <Button
                      variant={side === "1" ? "default" : "outline"}
                      className={side === "1" ? "bg-red-600 hover:bg-red-700 flex-1" : "flex-1"}
                      onClick={() => setSide("1")}
                      data-testid="button-side-sell"
                    >
                      <TrendingDown className="h-4 w-4 mr-1" />売り
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">注文種別</Label>
                  <div className="flex gap-2">
                    <Button
                      variant={orderType === "10" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setOrderType("10")}
                      data-testid="button-order-type-market"
                    >
                      成行
                    </Button>
                    <Button
                      variant={orderType === "20" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setOrderType("20")}
                      data-testid="button-order-type-limit"
                    >
                      指値
                    </Button>
                  </div>
                </div>

                {orderType === "20" && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">指値価格（円）</Label>
                    <Input
                      type="number"
                      value={price || ""}
                      onChange={e => setPrice(Number(e.target.value))}
                      placeholder="例: 2500"
                      data-testid="input-price"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-sm">数量（株）</Label>
                  <Input
                    type="number"
                    value={qty}
                    onChange={e => setQty(Number(e.target.value))}
                    min={1}
                    step={100}
                    data-testid="input-qty"
                  />
                  <p className="text-xs text-muted-foreground">TSE株の最低売買単位は通常100株</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">口座設定・確認</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm">口座種別</Label>
                  <Select value={accountType} onValueChange={setAccountType}>
                    <SelectTrigger data-testid="select-account-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">取引パスワード</Label>
                  <Input
                    type="password"
                    value={accountPassword}
                    onChange={e => setAccountPassword(e.target.value)}
                    placeholder="auカブコム証券 取引パスワード"
                    data-testid="input-account-password"
                  />
                  <p className="text-xs text-muted-foreground">注文・取消に必要です。保存されません。</p>
                </div>

                <div className="rounded-md border p-3 space-y-1.5 text-sm">
                  <p className="font-medium">注文確認</p>
                  <div className="flex justify-between text-muted-foreground">
                    <span>銘柄</span>
                    <span className="font-mono">{symbol || "—"} {symbolName && `(${symbolName})`}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>売買</span>
                    <span className={side === "2" ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                      {side === "2" ? "買い" : "売り"}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>注文種別</span>
                    <span>{orderType === "10" ? "成行" : "指値"}{orderType === "20" && price ? ` ${price.toLocaleString("ja-JP")}円` : ""}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>数量</span>
                    <span>{qty.toLocaleString("ja-JP")}株</span>
                  </div>
                  {orderType === "20" && price > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>概算金額</span>
                      <span>{(qty * price).toLocaleString("ja-JP")}円</span>
                    </div>
                  )}
                </div>

                <div className="rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 p-2.5 text-xs text-red-700 dark:text-red-300">
                  ⚠️ これはリアル口座への発注です。十分に確認してから発注してください。
                </div>

                <Button
                  className="w-full"
                  onClick={() => orderMutation.mutate()}
                  disabled={!symbol || !accountPassword || orderMutation.isPending || !isConnected}
                  data-testid="button-submit-order"
                >
                  {orderMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />送信中...</>
                  ) : (
                    <><Send className="h-4 w-4 mr-2" />発注する</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 注文照会 */}
        <TabsContent value="live" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <List className="h-4 w-4" />注文照会（kabu API リアルタイム）
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!isConnected ? (
                <p className="text-sm text-muted-foreground text-center py-6">未接続のためデータを取得できません</p>
              ) : !liveOrders ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : liveOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">注文なし</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">銘柄</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">売買</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">種別</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">数量</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">価格</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">状態</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">取消</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveOrders.map(order => (
                        <tr key={order.ID} className="border-b hover:bg-muted/30" data-testid={`row-live-order-${order.ID}`}>
                          <td className="py-2 px-2">
                            <p className="font-mono font-medium">{order.Symbol}</p>
                            {order.SymbolName && <p className="text-xs text-muted-foreground">{order.SymbolName}</p>}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <Badge variant={order.Side === "2" ? "default" : "destructive"} className="text-xs">
                              {order.SideLabel}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-center text-xs">{order.OrderTypeLabel}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{order.Qty.toLocaleString("ja-JP")}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{order.Price > 0 ? `${order.Price.toLocaleString("ja-JP")}円` : "成行"}</td>
                          <td className="py-2 px-2 text-center">
                            <Badge variant="outline" className="text-xs">{order.StatusLabel}</Badge>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => cancelMutation.mutate(order.ID)}
                              disabled={cancelMutation.isPending || !accountPassword}
                              data-testid={`button-cancel-order-${order.ID}`}
                            >
                              <XCircle className="h-4 w-4 text-red-500" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 保有株 */}
        <TabsContent value="positions" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4" />保有ポジション
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!isConnected ? (
                <p className="text-sm text-muted-foreground text-center py-6">未接続のためデータを取得できません</p>
              ) : !positions ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : positions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">保有ポジションなし</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">銘柄</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">売買</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">保有数</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">取得単価</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">現在値</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">損益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30" data-testid={`row-position-${i}`}>
                          <td className="py-2 px-2">
                            <p className="font-mono font-medium">{pos.Symbol}</p>
                            {pos.SymbolName && <p className="text-xs text-muted-foreground">{pos.SymbolName}</p>}
                            <p className="text-xs text-muted-foreground">{pos.ExchangeLabel}</p>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <Badge variant={pos.Side === "2" ? "default" : "destructive"} className="text-xs">
                              {pos.SideLabel}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums">{pos.Qty.toLocaleString("ja-JP")}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{pos.AvgPrice.toLocaleString("ja-JP")}円</td>
                          <td className="py-2 px-2 text-right tabular-nums">{pos.CurrentPrice ? `${pos.CurrentPrice.toLocaleString("ja-JP")}円` : "—"}</td>
                          <td className={`py-2 px-2 text-right tabular-nums font-medium ${(pos.ProfitLoss ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                            {pos.ProfitLoss != null ? `${pos.ProfitLoss >= 0 ? "+" : ""}${pos.ProfitLoss.toLocaleString("ja-JP")}円` : "—"}
                            {pos.ProfitLossRate != null && (
                              <span className="block text-xs">({pos.ProfitLossRate >= 0 ? "+" : ""}{pos.ProfitLossRate.toFixed(2)}%)</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 発注履歴 */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" />発注履歴（ローカル記録）
              </CardTitle>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : !history || history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">発注履歴なし</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">日時</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">銘柄</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">売買</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">種別</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">数量</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">価格</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">状態</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">注文ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(order => (
                        <tr key={order.id} className="border-b hover:bg-muted/30" data-testid={`row-history-${order.id}`}>
                          <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">
                            {order.createdAt ? new Date(order.createdAt).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                          <td className="py-2 px-2">
                            <p className="font-mono font-medium">{order.symbol}</p>
                            {order.symbolName && <p className="text-xs text-muted-foreground">{order.symbolName}</p>}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <Badge variant={order.side === "2" ? "default" : "destructive"} className="text-xs">
                              {order.side === "2" ? "買" : "売"}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-center text-xs">{order.orderType === "10" ? "成行" : "指値"}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{order.qty.toLocaleString("ja-JP")}</td>
                          <td className="py-2 px-2 text-right tabular-nums">
                            {order.price > 0 ? `${order.price.toLocaleString("ja-JP")}円` : "成行"}
                          </td>
                          <td className="py-2 px-2 text-center"><StatusBadge status={order.status} /></td>
                          <td className="py-2 px-2 text-xs font-mono text-muted-foreground">{order.orderId ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {history && history.some(o => o.status === "failed") && (
                <div className="mt-3 space-y-1">
                  {history.filter(o => o.status === "failed").map(o => (
                    <div key={o.id} className="text-xs text-red-500 bg-red-50 dark:bg-red-950 rounded px-2 py-1">
                      {o.symbol}: {o.errorMsg}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
