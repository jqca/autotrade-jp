import { useState, useMemo } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Wifi, WifiOff, Settings, RefreshCw, TrendingUp, TrendingDown,
  Send, XCircle, Wallet, List, History, AlertTriangle, ShoppingCart,
  Loader2, CheckCircle, Clock, Bot, Play, Square, RotateCcw,
  Sliders, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight,
  Activity, Target, ShieldAlert, GitCompare, TriangleAlert,
  BellRing, Siren, BarChart2, FileText, Zap,
} from "lucide-react";
import type { KabuOrder, AutoTrade } from "@shared/schema";

interface AutoTraderSettings {
  tickers: string[];
  minBuyIndicators: number;
  rsiMin: number;
  rsiMax: number;
  stopLossPercent: number;
  targetPercent: number;
  maxPositions: number;
  investPerTrade: number;
  maxDailyLossYen: number;
  intervalSeconds: number;
  cashMargin: number;
  accountType: number;
  delivType: number;
  volatilityFilterEnabled: boolean;
  volatilityThresholdPct: number;
}

interface OpenPosition {
  ticker: string;
  tickerName: string;
  buyPrice: number;
  qty: number;
  buyDate: string;
  stopLoss: number;
  target: number;
}

interface AutoTraderLogEntry {
  time: string;
  msg: string;
  type: "info" | "buy" | "sell" | "error" | "skip" | "stop";
}

interface AutoTraderStatus {
  running: boolean;
  mode: "paper" | "live";
  paperBalance: number;
  paperInitialBalance: number;
  openPositions: OpenPosition[];
  todayPnl: number;
  totalBuys: number;
  totalSells: number;
  log: AutoTraderLogEntry[];
  lastRunAt: string | null;
  settings: AutoTraderSettings;
}

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
  const [showAtSettings, setShowAtSettings] = useState(false);
  const [atMode, setAtMode] = useState<"paper" | "live">("paper");
  const [atTickers, setAtTickers] = useState("7203,6758,9984,4755,8306");
  const [atMinBuy, setAtMinBuy] = useState(2);
  const [atRsiMin, setAtRsiMin] = useState(40);
  const [atRsiMax, setAtRsiMax] = useState(65);
  const [atStopLoss, setAtStopLoss] = useState(2.0);
  const [atTarget, setAtTarget] = useState(3.0);
  const [atMaxPos, setAtMaxPos] = useState(3);
  const [atInvest, setAtInvest] = useState(100000);
  const [atMaxLoss, setAtMaxLoss] = useState(50000);
  const [atInterval, setAtInterval] = useState(60);
  const [atCashMargin, setAtCashMargin] = useState(1);
  const [atAccountType, setAtAccountType] = useState(4);
  const [atDelivType, setAtDelivType] = useState(0);
  const [atVolFilterEnabled, setAtVolFilterEnabled] = useState(false);
  const [atVolThreshold, setAtVolThreshold] = useState(5.0);

  // 本番確認ダイアログ
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);
  const [liveConfirmText, setLiveConfirmText] = useState("");

  // 発注パスワード
  const [orderPwInput, setOrderPwInput] = useState("");
  const [showOrderPwForm, setShowOrderPwForm] = useState(false);

  // 緊急清算
  const [emergencyConfirmOpen, setEmergencyConfirmOpen] = useState(false);

  // LINE Notify
  const [lineTokenInput, setLineTokenInput] = useState("");
  const [showLineForm, setShowLineForm] = useState(false);

  // 口座照合
  const [showReconcile, setShowReconcile] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<{
    botMode: string;
    botRunning: boolean;
    matched: { ticker: string; tickerName: string; qty: number; avgPrice: number }[];
    onlyBot: { ticker: string; tickerName: string; botQty: number; botBuyPrice: number }[];
    onlyKabu: { ticker: string; tickerName: string; kabuQty: number; kabuAvgPrice: number; currentPrice: number | null }[];
    mismatches: { ticker: string; tickerName: string; botQty: number; kabuQty: number; botBuyPrice: number; kabuAvgPrice: number; qtyDiff: number }[];
    checkedAt: string;
  } | null>(null);

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

  const { data: atStatus, refetch: refetchAt } = useQuery<AutoTraderStatus>({
    queryKey: ["/api/auto-trader/status"],
    refetchInterval: (query) => (query.state.data?.running ? 5000 : 15000),
  });

  const { data: orderPwStatus, refetch: refetchOrderPwStatus } = useQuery<{ set: boolean }>({
    queryKey: ["/api/auto-trader/order-password-status"],
    refetchInterval: 30000,
  });

  const { data: atTrades } = useQuery<AutoTrade[]>({
    queryKey: ["/api/auto-trader/trades"],
    refetchInterval: 15000,
  });

  const atStartMutation = useMutation({
    mutationFn: (mode: "paper" | "live") => apiRequest("POST", "/api/auto-trader/start", { mode }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/auto-trader/status"] }); },
    onError: (err: any) => toast({ title: "起動失敗", description: err.message, variant: "destructive" }),
  });

  const atStopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auto-trader/stop").then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/auto-trader/status"] }); },
    onError: (err: any) => toast({ title: "停止失敗", description: err.message, variant: "destructive" }),
  });

  const atSettingsMutation = useMutation({
    mutationFn: (settings: Partial<AutoTraderSettings>) => apiRequest("POST", "/api/auto-trader/settings", settings).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auto-trader/status"] });
      toast({ title: "設定保存", description: "自動売買設定を保存しました" });
      setShowAtSettings(false);
    },
    onError: (err: any) => toast({ title: "設定保存失敗", description: err.message, variant: "destructive" }),
  });

  const atResetMutation = useMutation({
    mutationFn: (amount: number) => apiRequest("POST", "/api/auto-trader/reset-paper", { amount }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auto-trader/status"] });
      toast({ title: "リセット完了", description: "ペーパートレード残高をリセットしました" });
    },
    onError: (err: any) => toast({ title: "リセット失敗", description: err.message, variant: "destructive" }),
  });

  const reconcileMutation = useMutation({
    mutationFn: () => apiRequest("GET", "/api/auto-trader/reconcile").then(r => r.json()),
    onSuccess: (data) => {
      setReconcileResult(data);
      setShowReconcile(true);
    },
    onError: (err: any) => toast({ title: "照合失敗", description: err.message, variant: "destructive" }),
  });

  const emergencyCloseMutation = useMutation({
    mutationFn: (reason: string) => apiRequest("POST", "/api/auto-trader/emergency-close", { reason }).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auto-trader/status"] });
      toast({ title: "緊急清算完了", description: `${data.closed}件清算 / ${data.failed}件失敗` });
      setEmergencyConfirmOpen(false);
    },
    onError: (err: any) => toast({ title: "緊急清算失敗", description: err.message, variant: "destructive" }),
  });

  const { data: lineNotifyStatus, refetch: refetchLineNotify } = useQuery<{ set: boolean }>({
    queryKey: ["/api/auto-trader/line-notify-status"],
    refetchInterval: 60000,
  });

  const lineNotifyMutation = useMutation({
    mutationFn: (token: string) => apiRequest("POST", "/api/auto-trader/line-notify", { token }).then(r => r.json()),
    onSuccess: () => {
      refetchLineNotify();
      setLineTokenInput("");
      setShowLineForm(false);
      toast({ title: "LINE Notify設定", description: "トークンを保存しました" });
    },
    onError: (err: any) => toast({ title: "設定失敗", description: err.message, variant: "destructive" }),
  });

  const lineNotifyTestMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auto-trader/line-notify/test").then(r => r.json()),
    onSuccess: () => toast({ title: "テスト送信完了", description: "LINEにテスト通知を送りました" }),
    onError: (err: any) => toast({ title: "送信失敗", description: err.message, variant: "destructive" }),
  });

  const weeklyReportMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auto-trader/weekly-report").then(r => r.json()),
    onSuccess: (data: any) => toast({ title: "週次レポート送信", description: data.message }),
    onError: (err: any) => toast({ title: "送信失敗", description: err.message, variant: "destructive" }),
  });

  const orderPwMutation = useMutation({
    mutationFn: (pw: string) => apiRequest("POST", "/api/auto-trader/order-password", { password: pw }).then(r => r.json()),
    onSuccess: () => {
      refetchOrderPwStatus();
      setOrderPwInput("");
      setShowOrderPwForm(false);
      toast({ title: "発注パスワード設定", description: "発注パスワードをサーバーに設定しました（メモリのみ保持）" });
    },
    onError: (err: any) => toast({ title: "設定失敗", description: err.message, variant: "destructive" }),
  });

  const saveAtSettings = () => {
    atSettingsMutation.mutate({
      tickers: atTickers.split(",").map(t => t.trim()).filter(Boolean),
      minBuyIndicators: atMinBuy,
      rsiMin: atRsiMin,
      rsiMax: atRsiMax,
      stopLossPercent: atStopLoss,
      targetPercent: atTarget,
      maxPositions: atMaxPos,
      investPerTrade: atInvest,
      maxDailyLossYen: atMaxLoss,
      intervalSeconds: atInterval,
      cashMargin: atCashMargin,
      accountType: atAccountType,
      delivType: atDelivType,
      volatilityFilterEnabled: atVolFilterEnabled,
      volatilityThresholdPct: atVolThreshold,
    });
  };

  const loadAtSettings = (s: AutoTraderSettings) => {
    setAtTickers(s.tickers.join(","));
    setAtMinBuy(s.minBuyIndicators);
    setAtRsiMin(s.rsiMin);
    setAtRsiMax(s.rsiMax);
    setAtStopLoss(s.stopLossPercent);
    setAtTarget(s.targetPercent);
    setAtMaxPos(s.maxPositions);
    setAtInvest(s.investPerTrade);
    setAtMaxLoss(s.maxDailyLossYen);
    setAtInterval(s.intervalSeconds);
    setAtCashMargin(s.cashMargin ?? 1);
    setAtAccountType(s.accountType ?? 4);
    setAtDelivType(s.delivType ?? 0);
    setAtVolFilterEnabled(s.volatilityFilterEnabled ?? false);
    setAtVolThreshold(s.volatilityThresholdPct ?? 5.0);
  };

  const pnlChartData = useMemo(() => {
    if (!atTrades) return [];
    const sells = atTrades
      .filter(t => t.action !== "buy" && t.profitLoss != null)
      .slice()
      .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    let cum = 0;
    return sells.map(t => {
      cum += t.profitLoss ?? 0;
      return {
        date: t.createdAt ? new Date(t.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit" }) : "",
        pnl: Math.round(cum),
        trade: Math.round(t.profitLoss ?? 0),
      };
    });
  }, [atTrades]);

  const showGlobalWarning = atStatus?.running && atStatus?.mode === "live" && !orderPwStatus?.set;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* Feature 3: グローバル警告バナー */}
      {showGlobalWarning && (
        <div className="sticky top-0 z-50 flex items-center gap-2 rounded-md border border-red-500 bg-red-600 px-4 py-2.5 text-white text-sm shadow-lg animate-pulse"
          data-testid="banner-global-warning">
          <Siren className="h-4 w-4 shrink-0" />
          <strong>本番稼働中 — 発注パスワード未設定!</strong>
          <span className="ml-1 font-normal">全発注が失敗します。今すぐ発注パスワードを設定してください。</span>
        </div>
      )}
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
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="order" data-testid="tab-order"><Send className="h-3.5 w-3.5 mr-1" />発注</TabsTrigger>
          <TabsTrigger value="live" data-testid="tab-live-orders"><List className="h-3.5 w-3.5 mr-1" />注文照会</TabsTrigger>
          <TabsTrigger value="positions" data-testid="tab-positions"><Wallet className="h-3.5 w-3.5 mr-1" />保有株</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history"><History className="h-3.5 w-3.5 mr-1" />発注履歴</TabsTrigger>
          <TabsTrigger value="auto" data-testid="tab-auto-trader" className="relative">
            <Bot className="h-3.5 w-3.5 mr-1" />自動売買
            {atStatus?.running && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}
          </TabsTrigger>
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

        {/* 自動売買タブ */}
        <TabsContent value="auto" className="mt-4 space-y-4">
          {/* モードと制御 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  自動売買エンジン
                  {atStatus?.running ? (
                    <Badge className="bg-emerald-500 text-white text-xs">稼働中</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">停止中</Badge>
                  )}
                  {atStatus && (
                    <Badge variant={atStatus.mode === "live" ? "destructive" : "outline"} className="text-xs">
                      {atStatus.mode === "live" ? "🔴 本番" : "📄 ペーパー"}
                    </Badge>
                  )}
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => refetchAt()} data-testid="button-refresh-at">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              {atStatus?.lastRunAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  最終チェック: {new Date(atStatus.lastRunAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 警告 (本番モード) */}
              {atMode === "live" && (
                <div className="flex gap-2 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p><strong>本番モード:</strong> 実際の資金で自動発注されます。kabu接続が必要です。十分なリスク管理を確認してから起動してください。</p>
                </div>
              )}

              {/* 発注パスワード設定 (本番モード) */}
              {atMode === "live" && (
                <div className={`rounded-md border p-3 text-sm space-y-2 ${orderPwStatus?.set ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950" : "border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {orderPwStatus?.set ? (
                        <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0" />
                      )}
                      <span className={`font-medium text-xs ${orderPwStatus?.set ? "text-emerald-800 dark:text-emerald-300" : "text-orange-800 dark:text-orange-300"}`}>
                        発注パスワード: {orderPwStatus?.set ? "設定済み ✓" : "未設定（本番発注には必須）"}
                      </span>
                    </div>
                    <button
                      onClick={() => setShowOrderPwForm(!showOrderPwForm)}
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                      data-testid="button-toggle-order-pw"
                    >
                      {showOrderPwForm ? "閉じる" : orderPwStatus?.set ? "変更" : "設定する"}
                    </button>
                  </div>
                  {showOrderPwForm && (
                    <form
                      onSubmit={e => { e.preventDefault(); if (orderPwInput) orderPwMutation.mutate(orderPwInput); }}
                      className="flex gap-2 items-center"
                    >
                      <Input
                        type="password"
                        value={orderPwInput}
                        onChange={e => setOrderPwInput(e.target.value)}
                        placeholder="証券口座のパスワード"
                        className="h-8 text-sm flex-1"
                        data-testid="input-order-password"
                        autoComplete="new-password"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="h-8"
                        disabled={!orderPwInput || orderPwMutation.isPending}
                        data-testid="button-set-order-password"
                      >
                        {orderPwMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "設定"}
                      </Button>
                    </form>
                  )}
                  <p className="text-xs text-muted-foreground">
                    ※ パスワードはサーバーメモリのみに保持されます。DBには保存されません。サーバー再起動後は再設定が必要です。
                  </p>
                </div>
              )}

              {/* モード選択と起動停止 */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">モード:</Label>
                  <div className="flex rounded-md border overflow-hidden">
                    <button
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${atMode === "paper" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      onClick={() => setAtMode("paper")}
                      data-testid="button-mode-paper"
                    >📄 ペーパー</button>
                    <button
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${atMode === "live" ? "bg-red-500 text-white" : "bg-background hover:bg-muted"}`}
                      onClick={() => setAtMode("live")}
                      data-testid="button-mode-live"
                    >🔴 本番</button>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!atStatus?.running ? (
                    <Button
                      onClick={() => {
                        if (atMode === "live") {
                          setLiveConfirmText("");
                          setLiveConfirmOpen(true);
                        } else {
                          atStartMutation.mutate(atMode);
                        }
                      }}
                      disabled={atStartMutation.isPending}
                      className={atMode === "live" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
                      data-testid="button-at-start"
                    >
                      {atStartMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                      起動
                    </Button>
                  ) : (
                    <Button
                      onClick={() => atStopMutation.mutate()}
                      disabled={atStopMutation.isPending}
                      variant="destructive"
                      data-testid="button-at-stop"
                    >
                      {atStopMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Square className="h-4 w-4 mr-1" />}
                      停止
                    </Button>
                  )}
                  {atStatus?.mode === "paper" && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => atResetMutation.mutate(1_000_000)}
                      disabled={atResetMutation.isPending || atStatus?.running}
                      data-testid="button-at-reset"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />リセット
                    </Button>
                  )}
                  {atStatus?.mode === "live" && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => reconcileMutation.mutate()}
                      disabled={reconcileMutation.isPending}
                      data-testid="button-reconcile"
                    >
                      {reconcileMutation.isPending
                        ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        : <GitCompare className="h-3.5 w-3.5 mr-1" />}
                      口座照合
                    </Button>
                  )}
                  {/* Feature 1: 緊急全清算ボタン */}
                  {atStatus && atStatus.openPositions.length > 0 && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setEmergencyConfirmOpen(true)}
                      disabled={emergencyCloseMutation.isPending}
                      className="border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      data-testid="button-emergency-close"
                    >
                      {emergencyCloseMutation.isPending
                        ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        : <Zap className="h-3.5 w-3.5 mr-1" />}
                      全清算
                    </Button>
                  )}
                </div>
              </div>

              {/* 統計カード */}
              {atStatus && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {atStatus.mode === "paper" && (
                    <>
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">ペーパー残高</p>
                        <p className="text-lg font-bold font-mono" data-testid="text-paper-balance">
                          ¥{atStatus.paperBalance.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          初期¥{atStatus.paperInitialBalance.toLocaleString()}
                        </p>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">本日損益</p>
                        <p className={`text-lg font-bold font-mono ${atStatus.todayPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}
                          data-testid="text-today-pnl">
                          {atStatus.todayPnl >= 0 ? "+" : ""}¥{Math.round(atStatus.todayPnl).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          累計P&L: ¥{Math.round(atStatus.paperBalance - atStatus.paperInitialBalance).toLocaleString()}
                        </p>
                      </div>
                    </>
                  )}
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">オープンポジション</p>
                    <p className="text-lg font-bold" data-testid="text-open-positions">
                      {atStatus.openPositions.length} <span className="text-sm font-normal text-muted-foreground">/ {atStatus.settings.maxPositions}</span>
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">取引回数</p>
                    <p className="text-lg font-bold" data-testid="text-trade-count">
                      買{atStatus.totalBuys} 売{atStatus.totalSells}
                    </p>
                  </div>
                </div>
              )}

              {/* 口座照合パネル */}
              {showReconcile && reconcileResult && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-3" data-testid="panel-reconcile">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <GitCompare className="h-4 w-4" />
                      口座照合結果
                      <span className="text-xs text-muted-foreground font-normal">
                        {new Date(reconcileResult.checkedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                      </span>
                    </h4>
                    <button onClick={() => setShowReconcile(false)} className="text-muted-foreground hover:text-foreground text-xs">✕ 閉じる</button>
                  </div>

                  {reconcileResult.mismatches.length === 0 && reconcileResult.onlyBot.length === 0 && reconcileResult.onlyKabu.length === 0 ? (
                    <div className="flex items-center gap-2 text-emerald-600 text-sm">
                      <CheckCircle className="h-4 w-4" />
                      <span>完全一致 — ボット内部とkabu口座のポジションは一致しています（{reconcileResult.matched.length}銘柄）</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reconcileResult.mismatches.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-1 flex items-center gap-1">
                            <TriangleAlert className="h-3.5 w-3.5" />数量・価格の乖離 ({reconcileResult.mismatches.length}件)
                          </p>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground border-b">
                                <th className="text-left pb-1">銘柄</th>
                                <th className="text-right pb-1">Bot数量</th>
                                <th className="text-right pb-1">kabu数量</th>
                                <th className="text-right pb-1">Bot単価</th>
                                <th className="text-right pb-1">kabu平均</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reconcileResult.mismatches.map(m => (
                                <tr key={m.ticker} className="border-b border-dashed" data-testid={`row-mismatch-${m.ticker}`}>
                                  <td className="py-1 font-mono">{m.ticker} <span className="text-muted-foreground">{m.tickerName}</span></td>
                                  <td className="text-right py-1 font-mono">{m.botQty}</td>
                                  <td className="text-right py-1 font-mono text-orange-600">{m.kabuQty}</td>
                                  <td className="text-right py-1 font-mono">¥{m.botBuyPrice.toLocaleString()}</td>
                                  <td className="text-right py-1 font-mono text-orange-600">¥{m.kabuAvgPrice.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {reconcileResult.onlyBot.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />Botのみ（kabuに存在しない） ({reconcileResult.onlyBot.length}件)
                          </p>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground border-b">
                                <th className="text-left pb-1">銘柄</th>
                                <th className="text-right pb-1">Bot数量</th>
                                <th className="text-right pb-1">Bot取得単価</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reconcileResult.onlyBot.map(p => (
                                <tr key={p.ticker} className="border-b border-dashed" data-testid={`row-only-bot-${p.ticker}`}>
                                  <td className="py-1 font-mono">{p.ticker} <span className="text-muted-foreground">{p.tickerName}</span></td>
                                  <td className="text-right py-1 font-mono">{p.botQty}</td>
                                  <td className="text-right py-1 font-mono">¥{p.botBuyPrice.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {reconcileResult.onlyKabu.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />kabuのみ（Botが把握していない） ({reconcileResult.onlyKabu.length}件)
                          </p>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground border-b">
                                <th className="text-left pb-1">銘柄</th>
                                <th className="text-right pb-1">kabu数量</th>
                                <th className="text-right pb-1">kabu平均</th>
                                <th className="text-right pb-1">現在値</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reconcileResult.onlyKabu.map(p => (
                                <tr key={p.ticker} className="border-b border-dashed" data-testid={`row-only-kabu-${p.ticker}`}>
                                  <td className="py-1 font-mono">{p.ticker} <span className="text-muted-foreground">{p.tickerName}</span></td>
                                  <td className="text-right py-1 font-mono">{p.kabuQty}</td>
                                  <td className="text-right py-1 font-mono">¥{p.kabuAvgPrice.toLocaleString()}</td>
                                  <td className="text-right py-1 font-mono">{p.currentPrice != null ? `¥${p.currentPrice.toLocaleString()}` : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {reconcileResult.matched.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">一致銘柄 {reconcileResult.matched.length}件を表示</summary>
                      <table className="w-full mt-2">
                        <thead>
                          <tr className="text-muted-foreground border-b">
                            <th className="text-left pb-1">銘柄</th>
                            <th className="text-right pb-1">数量</th>
                            <th className="text-right pb-1">平均単価</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconcileResult.matched.map(m => (
                            <tr key={m.ticker} className="border-b border-dashed" data-testid={`row-matched-${m.ticker}`}>
                              <td className="py-1 font-mono">{m.ticker} <span className="text-muted-foreground">{m.tickerName}</span></td>
                              <td className="text-right py-1 font-mono">{m.qty}</td>
                              <td className="text-right py-1 font-mono">¥{m.avgPrice.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 設定パネル */}
          <Card>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => {
              if (!showAtSettings && atStatus?.settings) loadAtSettings(atStatus.settings);
              setShowAtSettings(!showAtSettings);
            }}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sliders className="h-4 w-4" />戦略設定
                </CardTitle>
                {showAtSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {showAtSettings && (
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label className="text-xs">監視銘柄コード（カンマ区切り）</Label>
                    <Input value={atTickers} onChange={e => setAtTickers(e.target.value)}
                      placeholder="7203,6758,9984" className="mt-1 font-mono text-sm"
                      data-testid="input-at-tickers" />
                  </div>
                  <div>
                    <Label className="text-xs">最小買いシグナル数 (1-4)</Label>
                    <Input type="number" min={1} max={4} value={atMinBuy}
                      onChange={e => setAtMinBuy(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-min-buy" />
                  </div>
                  <div>
                    <Label className="text-xs">チェック間隔（秒）</Label>
                    <Input type="number" min={30} value={atInterval}
                      onChange={e => setAtInterval(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-interval" />
                  </div>
                  <div>
                    <Label className="text-xs">RSI 下限（買い判定）</Label>
                    <Input type="number" min={1} max={100} value={atRsiMin}
                      onChange={e => setAtRsiMin(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-rsi-min" />
                  </div>
                  <div>
                    <Label className="text-xs">RSI 上限（買い判定）</Label>
                    <Input type="number" min={1} max={100} value={atRsiMax}
                      onChange={e => setAtRsiMax(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-rsi-max" />
                  </div>
                  <div>
                    <Label className="text-xs">ストップロス（%）</Label>
                    <Input type="number" min={0.1} step={0.1} value={atStopLoss}
                      onChange={e => setAtStopLoss(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-stop-loss" />
                  </div>
                  <div>
                    <Label className="text-xs">利確目標（%）</Label>
                    <Input type="number" min={0.1} step={0.1} value={atTarget}
                      onChange={e => setAtTarget(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-target" />
                  </div>
                  <div>
                    <Label className="text-xs">最大ポジション数</Label>
                    <Input type="number" min={1} max={20} value={atMaxPos}
                      onChange={e => setAtMaxPos(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-max-pos" />
                  </div>
                  <div>
                    <Label className="text-xs">1回あたり投資額（円）</Label>
                    <Input type="number" min={10000} step={10000} value={atInvest}
                      onChange={e => setAtInvest(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-invest" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">日次最大損失額（円）— これを超えると当日取引停止</Label>
                    <Input type="number" min={0} step={10000} value={atMaxLoss}
                      onChange={e => setAtMaxLoss(Number(e.target.value))} className="mt-1"
                      data-testid="input-at-max-loss" />
                  </div>
                </div>

                {/* Feature 4: 発注パラメータ */}
                <Separator className="my-1" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">発注パラメータ（本番モード）</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">取引区分</Label>
                    <Select value={String(atCashMargin)} onValueChange={v => setAtCashMargin(Number(v))}>
                      <SelectTrigger className="mt-1" data-testid="select-cash-margin">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">現物</SelectItem>
                        <SelectItem value="2">信用</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">口座種別</Label>
                    <Select value={String(atAccountType)} onValueChange={v => setAtAccountType(Number(v))}>
                      <SelectTrigger className="mt-1" data-testid="select-account-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="4">特定口座</SelectItem>
                        <SelectItem value="3">一般口座</SelectItem>
                        <SelectItem value="2">NISA口座</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">受渡区分</Label>
                    <Select value={String(atDelivType)} onValueChange={v => setAtDelivType(Number(v))}>
                      <SelectTrigger className="mt-1" data-testid="select-deliv-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">指定なし</SelectItem>
                        <SelectItem value="2">自動</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Feature 8: ボラティリティフィルター */}
                <Separator className="my-1" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">ボラティリティフィルター</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={atVolFilterEnabled}
                      onCheckedChange={setAtVolFilterEnabled}
                      data-testid="switch-vol-filter"
                    />
                    <Label className="text-sm cursor-pointer" onClick={() => setAtVolFilterEnabled(!atVolFilterEnabled)}>
                      ATRフィルター有効
                    </Label>
                  </div>
                  {atVolFilterEnabled && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs whitespace-nowrap">閾値（ATR%）</Label>
                      <Input type="number" min={0.5} max={30} step={0.5} value={atVolThreshold}
                        onChange={e => setAtVolThreshold(Number(e.target.value))} className="w-24"
                        data-testid="input-vol-threshold" />
                      <span className="text-xs text-muted-foreground">%以上の銘柄をスキップ</span>
                    </div>
                  )}
                </div>

                <Button onClick={saveAtSettings} disabled={atSettingsMutation.isPending} className="w-full"
                  data-testid="button-at-save-settings">
                  {atSettingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  設定を保存
                </Button>
              </CardContent>
            )}
          </Card>

          {/* Feature 2: LINE Notify設定 + Feature 7: 週次レポート */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <BellRing className="h-4 w-4" />LINE Notify / レポート
                  {lineNotifyStatus?.set && (
                    <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border-green-300">設定済 ✓</Badge>
                  )}
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => weeklyReportMutation.mutate()}
                    disabled={weeklyReportMutation.isPending || !lineNotifyStatus?.set}
                    data-testid="button-weekly-report"
                  >
                    {weeklyReportMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
                    週次レポート送信
                  </Button>
                  <button
                    onClick={() => setShowLineForm(!showLineForm)}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    data-testid="button-toggle-line-form"
                  >
                    {showLineForm ? "閉じる" : lineNotifyStatus?.set ? "トークン変更" : "設定する"}
                  </button>
                </div>
              </div>
            </CardHeader>
            {showLineForm && (
              <CardContent className="space-y-3">
                <div className="rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300">
                  <p className="font-medium mb-1">LINE Notify トークンの取得方法</p>
                  <ol className="list-decimal ml-4 space-y-0.5">
                    <li>notify-bot.line.me/ja にアクセス</li>
                    <li>「トークンを発行する」からトークンを発行</li>
                    <li>通知先グループまたは「1:1 で LINE Notify から通知を受け取る」を選択</li>
                    <li>発行されたトークンを以下に入力</li>
                  </ol>
                </div>
                <form
                  onSubmit={e => { e.preventDefault(); if (lineTokenInput) lineNotifyMutation.mutate(lineTokenInput); }}
                  className="flex gap-2 items-center"
                >
                  <Input
                    type="password"
                    value={lineTokenInput}
                    onChange={e => setLineTokenInput(e.target.value)}
                    placeholder="LINE Notify アクセストークン"
                    className="h-8 text-sm flex-1"
                    data-testid="input-line-token"
                    autoComplete="new-password"
                  />
                  <Button type="submit" size="sm" className="h-8" disabled={!lineTokenInput || lineNotifyMutation.isPending} data-testid="button-save-line-token">
                    {lineNotifyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "保存"}
                  </Button>
                  {lineNotifyStatus?.set && (
                    <Button
                      type="button" size="sm" variant="outline" className="h-8"
                      onClick={() => lineNotifyTestMutation.mutate()}
                      disabled={lineNotifyTestMutation.isPending}
                      data-testid="button-test-line"
                    >
                      {lineNotifyTestMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "テスト"}
                    </Button>
                  )}
                </form>
                <p className="text-xs text-muted-foreground">トークンはDBに暗号化保存されます。買い約定・売り約定・緊急停止・日次損失上限到達時に通知が届きます。</p>
              </CardContent>
            )}
          </Card>

          {/* Feature 5: 損益グラフ */}
          {pnlChartData.length >= 2 && (
            <Card data-testid="card-pnl-chart">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="h-4 w-4" />累積損益グラフ
                  <span className={`text-sm font-normal ml-auto ${pnlChartData[pnlChartData.length - 1]?.pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {pnlChartData[pnlChartData.length - 1]?.pnl >= 0 ? "+" : ""}
                    ¥{pnlChartData[pnlChartData.length - 1]?.pnl.toLocaleString()}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={pnlChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `¥${(v / 1000).toFixed(0)}k`} width={48} />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        `¥${value.toLocaleString()}`,
                        name === "pnl" ? "累積P&L" : "取引P&L"
                      ]}
                      labelStyle={{ fontSize: 11 }}
                      contentStyle={{ fontSize: 11 }}
                    />
                    <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="3 3" />
                    <Line
                      type="monotone" dataKey="pnl"
                      stroke="hsl(var(--primary))" strokeWidth={2} dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* オープンポジション */}
          {atStatus && atStatus.openPositions.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />オープンポジション ({atStatus.openPositions.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {atStatus.openPositions.map(pos => (
                    <div key={pos.ticker} className="flex items-center justify-between rounded-lg border p-3 gap-3 flex-wrap"
                      data-testid={`card-at-position-${pos.ticker}`}>
                      <div>
                        <p className="font-medium text-sm">{pos.ticker} <span className="text-muted-foreground font-normal">{pos.tickerName}</span></p>
                        <p className="text-xs text-muted-foreground">{pos.qty}株 @¥{pos.buyPrice.toLocaleString()}</p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p className="text-red-500">SL ¥{Math.round(pos.stopLoss).toLocaleString()}</p>
                        <p className="text-emerald-500">TP ¥{Math.round(pos.target).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 活動ログ */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" />活動ログ
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!atStatus || atStatus.log.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">ログなし（起動後に表示されます）</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs">
                  {atStatus.log.map((entry, i) => (
                    <div key={i} className={`flex gap-2 py-0.5 border-b border-border/40 last:border-0 ${
                      entry.type === "buy" ? "text-emerald-600 dark:text-emerald-400" :
                      entry.type === "sell" ? "text-blue-600 dark:text-blue-400" :
                      entry.type === "error" ? "text-red-500" :
                      entry.type === "stop" ? "text-amber-600 dark:text-amber-400" :
                      entry.type === "skip" ? "text-muted-foreground/70" :
                      "text-foreground"
                    }`} data-testid={`log-at-${i}`}>
                      <span className="shrink-0 text-muted-foreground/60">
                        {new Date(entry.time).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span>{entry.msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 取引履歴（DB） */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" />自動売買履歴
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!atTrades || atTrades.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">取引履歴なし</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-1.5 pr-3">日時</th>
                        <th className="text-left py-1.5 pr-3">モード</th>
                        <th className="text-left py-1.5 pr-3">種別</th>
                        <th className="text-left py-1.5 pr-3">銘柄</th>
                        <th className="text-right py-1.5 pr-3">価格</th>
                        <th className="text-right py-1.5 pr-3">数量</th>
                        <th className="text-right py-1.5">損益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {atTrades.slice(0, 50).map(t => (
                        <tr key={t.id} className="border-b border-border/40 last:border-0"
                          data-testid={`row-at-trade-${t.id}`}>
                          <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                            {t.createdAt ? new Date(t.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}
                          </td>
                          <td className="py-1.5 pr-3">
                            <Badge variant={t.mode === "live" ? "destructive" : "outline"} className="text-[10px] px-1">
                              {t.mode === "live" ? "本番" : "ペーパー"}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-3">
                            <span className={`font-medium ${t.action === "buy" ? "text-emerald-600" : "text-blue-600"}`}>
                              {t.action === "buy" ? "買" : t.action === "stop_loss" ? "損切" : t.action === "target" ? "利確" : "売"}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3">{t.ticker}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">¥{t.price.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right">{t.qty}</td>
                          <td className={`py-1.5 text-right font-mono ${t.profitLoss == null ? "" : t.profitLoss >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {t.profitLoss != null ? `${t.profitLoss >= 0 ? "+" : ""}¥${Math.round(t.profitLoss).toLocaleString()}` : "-"}
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

      </Tabs>

      {/* ===== 緊急全清算確認ダイアログ ===== */}
      <Dialog open={emergencyConfirmOpen} onOpenChange={setEmergencyConfirmOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-emergency-close">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Zap className="h-5 w-5" />全ポジション緊急清算
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              現在オープン中の全ポジション（{atStatus?.openPositions.length ?? 0}件）を成行売りで即時清算します。この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          {atStatus?.openPositions && atStatus.openPositions.length > 0 && (
            <div className="rounded-md border p-3 space-y-1">
              {atStatus.openPositions.map(pos => (
                <div key={pos.ticker} className="flex justify-between text-sm">
                  <span className="font-mono font-medium">{pos.ticker}</span>
                  <span className="text-muted-foreground">{pos.qty}株 @¥{pos.buyPrice.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEmergencyConfirmOpen(false)} data-testid="button-emergency-cancel">
              キャンセル
            </Button>
            <Button
              onClick={() => emergencyCloseMutation.mutate("UIから緊急清算")}
              disabled={emergencyCloseMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="button-emergency-confirm"
            >
              {emergencyCloseMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <Zap className="h-4 w-4 mr-1" />}
              全清算する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 本番起動確認ダイアログ ===== */}
      <Dialog open={liveConfirmOpen} onOpenChange={setLiveConfirmOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-live-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-5 w-5" />本番取引を開始しますか？
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              実際の資金を使った自動発注が開始されます。以下の設定を確認してください。
            </DialogDescription>
          </DialogHeader>

          {atStatus && (
            <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-sm space-y-1.5">
              <p className="font-semibold text-red-800 dark:text-red-300 text-xs uppercase tracking-wide mb-2">現在の設定</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">監視銘柄</span>
                <span className="font-mono font-medium">{atStatus.settings.tickers.join(", ")}</span>
                <span className="text-muted-foreground">1回の投資額</span>
                <span className="font-mono font-medium">¥{atStatus.settings.investPerTrade.toLocaleString()}</span>
                <span className="text-muted-foreground">最大ポジション数</span>
                <span className="font-mono font-medium">{atStatus.settings.maxPositions}件</span>
                <span className="text-muted-foreground">損切りライン</span>
                <span className="font-mono font-medium text-red-600">-{atStatus.settings.stopLossPercent}%</span>
                <span className="text-muted-foreground">利確ライン</span>
                <span className="font-mono font-medium text-emerald-600">+{atStatus.settings.targetPercent}%</span>
                <span className="text-muted-foreground">日次最大損失</span>
                <span className="font-mono font-medium text-red-600">¥{atStatus.settings.maxDailyLossYen.toLocaleString()}</span>
                <span className="text-muted-foreground">チェック間隔</span>
                <span className="font-mono font-medium">{atStatus.settings.intervalSeconds}秒</span>
              </div>
            </div>
          )}

          {/* パスワード未設定の場合は警告 */}
          {!orderPwStatus?.set && (
            <div className="flex gap-2 rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950 p-3 text-xs text-orange-800 dark:text-orange-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">発注パスワードが未設定です</p>
                <p>本番起動する前に、エンジンカード内の「発注パスワード」を設定してください。未設定のまま起動した場合、全発注が「発注パスワード未設定」エラーで失敗します。</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              確認のため <span className="font-bold text-red-600 font-mono">本番取引開始</span> と入力してください
            </Label>
            <Input
              value={liveConfirmText}
              onChange={e => setLiveConfirmText(e.target.value)}
              placeholder="本番取引開始"
              className="font-mono"
              data-testid="input-live-confirm"
              autoComplete="off"
            />
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { setLiveConfirmOpen(false); setLiveConfirmText(""); }}
              data-testid="button-live-confirm-cancel"
            >
              キャンセル
            </Button>
            <Button
              onClick={() => {
                setLiveConfirmOpen(false);
                setLiveConfirmText("");
                atStartMutation.mutate("live");
              }}
              disabled={liveConfirmText !== "本番取引開始" || !orderPwStatus?.set || atStartMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="button-live-confirm-ok"
            >
              {atStartMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <ShieldAlert className="h-4 w-4 mr-1" />}
              本番起動する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
