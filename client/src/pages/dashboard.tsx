import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Activity, Wallet, BarChart3, Zap, Clock, Timer, Database } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Stock, Strategy, Trade, PortfolioPosition } from "@shared/schema";

interface BatchProgress {
  status: string;
  total: number;
  processed: number;
  calculated?: number;
  updated?: number;
  errors: number;
  message: string;
}

interface IntradayFetchProgress {
  status: string;
  mode: string | null;
  total: number;
  processed: number;
  stored: number;
  errors: number;
  message: string;
}

interface IntradayStats {
  totalBars: number;
  distinctTickers: number;
  earliestDate: string | null;
  latestDate: string | null;
}

interface SchedulerStatus {
  enabled: boolean;
  schedule: string;
  lastRunAt: string | null;
  nextRunAt: string;
  fetchStatus: string;
  indicatorStatus: string;
  indicatorProgress: BatchProgress | null;
  intradayStatus: string;
  intradayProgress: IntradayFetchProgress | null;
  intradayIndicatorStatus: string;
  intradayIndicatorProgress: BatchProgress | null;
}

function StatCard({ title, value, change, icon: Icon, trend }: {
  title: string;
  value: string;
  change?: string;
  icon: any;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`stat-${title}`}>{value}</div>
        {change && (
          <p className={`text-xs mt-1 ${trend === "up" ? "text-emerald-600 dark:text-emerald-400" : trend === "down" ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
            {trend === "up" && <TrendingUp className="inline h-3 w-3 mr-1" />}
            {trend === "down" && <TrendingDown className="inline h-3 w-3 mr-1" />}
            {change}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface NikkeiData {
  range: string;
  interval: string;
  trend: "up" | "down" | "neutral";
  latest: { close: number; change: number; changePercent: number; date: string };
  period: { change: number; changePercent: number };
  ma25: number | null;
  ma75: number | null;
  prices: { date: string; close: number; high: number; low: number; open: number; volume: number }[];
}

export default function Dashboard() {
  const [nikkeiRange, setNikkeiRange] = useState("1y");
  const { data: stocksRaw, isLoading: stocksLoading } = useQuery<Stock[]>({ queryKey: ["/api/stocks"] });
  const stocks = stocksRaw?.filter(s => s.currentPrice > 0 && s.previousClose > 0);
  const { data: strategies, isLoading: strategiesLoading } = useQuery<Strategy[]>({ queryKey: ["/api/strategies"] });
  const { data: trades, isLoading: tradesLoading } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { data: positions, isLoading: positionsLoading } = useQuery<PortfolioPosition[]>({ queryKey: ["/api/portfolio"] });
  const { data: scheduler } = useQuery<SchedulerStatus>({ queryKey: ["/api/scheduler"] });
  const { data: jquantsStatus } = useQuery<{ configured: boolean }>({ queryKey: ["/api/jquants/status"] });
  const { data: intradayStats } = useQuery<IntradayStats>({ queryKey: ["/api/intraday/status"] });
  const { data: intradayProgress } = useQuery<IntradayFetchProgress>({
    queryKey: ["/api/intraday/progress"],
    refetchInterval: (query) => query.state.data?.status === "running" ? 2000 : false,
  });
  const { data: nikkeiData, isLoading: nikkeiLoading } = useQuery<NikkeiData>({
    queryKey: ["/api/market-index/nikkei225", nikkeiRange],
    queryFn: async () => {
      const res = await fetch(`/api/market-index/nikkei225?range=${nikkeiRange}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const toggleScheduler = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PATCH", "/api/scheduler", { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler"] });
    },
  });

  const startIntradayFetch = useMutation({
    mutationFn: async (mode: "daily" | "seed") => {
      await apiRequest("POST", "/api/intraday/fetch", { mode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intraday/progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intraday/status"] });
    },
  });

  const aggregateIntraday = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/intraday/aggregate", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intraday/progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intraday/status"] });
    },
  });

  const isLoading = stocksLoading || strategiesLoading || tradesLoading || positionsLoading;

  const totalValue = positions?.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0) ?? 0;
  const totalCost = positions?.reduce((sum, p) => sum + p.avgPrice * p.quantity, 0) ?? 0;
  const totalPnL = totalValue - totalCost;
  const pnlPercent = totalCost > 0 ? ((totalPnL / totalCost) * 100).toFixed(2) : "0.00";
  const activeStrategies = strategies?.filter(s => s.isActive).length ?? 0;
  const todayTrades = trades?.filter(t => {
    const tradeDate = new Date(t.executedAt!);
    const today = new Date();
    return tradeDate.toDateString() === today.toDateString();
  }).length ?? 0;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">ダッシュボード</h1>
        <p className="text-muted-foreground">ポートフォリオの概要と取引状況</p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="ポートフォリオ総額"
          value={`${totalValue.toLocaleString("ja-JP")} 円`}
          change={`${totalPnL >= 0 ? "+" : ""}${totalPnL.toLocaleString("ja-JP")} 円 (${pnlPercent}%)`}
          icon={Wallet}
          trend={totalPnL >= 0 ? "up" : "down"}
        />
        <StatCard
          title="稼働中の戦略"
          value={`${activeStrategies}`}
          change={`全${strategies?.length ?? 0}件の戦略`}
          icon={Zap}
          trend="neutral"
        />
        <StatCard
          title="本日の取引"
          value={`${todayTrades}`}
          change={`全${trades?.length ?? 0}件の取引`}
          icon={Activity}
          trend="neutral"
        />
        <StatCard
          title="保有銘柄数"
          value={`${positions?.length ?? 0} 銘柄`}
          icon={BarChart3}
          trend="neutral"
        />
      </div>

      <Card data-testid="card-nikkei225">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">日経平均株価</CardTitle>
              {nikkeiData && (
                <>
                  <span className="text-xl font-bold" data-testid="text-nikkei-price">
                    {nikkeiData.latest.close.toLocaleString("ja-JP", { minimumFractionDigits: 2 })}
                  </span>
                  <Badge
                    variant={nikkeiData.latest.change >= 0 ? "default" : "destructive"}
                    className="text-xs"
                    data-testid="badge-nikkei-change"
                  >
                    {nikkeiData.latest.change >= 0 ? "+" : ""}{nikkeiData.latest.change.toLocaleString("ja-JP")}
                    ({nikkeiData.latest.changePercent >= 0 ? "+" : ""}{nikkeiData.latest.changePercent.toFixed(2)}%)
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      nikkeiData.trend === "up" ? "border-emerald-300 text-emerald-700 dark:text-emerald-400" :
                      nikkeiData.trend === "down" ? "border-red-300 text-red-500 dark:text-red-400" :
                      ""
                    }
                    data-testid="badge-nikkei-trend"
                  >
                    {nikkeiData.trend === "up" ? "上昇トレンド" : nikkeiData.trend === "down" ? "下降トレンド" : "レンジ"}
                  </Badge>
                </>
              )}
            </div>
            <Select value={nikkeiRange} onValueChange={setNikkeiRange}>
              <SelectTrigger className="w-[100px]" data-testid="select-nikkei-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1mo">1ヶ月</SelectItem>
                <SelectItem value="3mo">3ヶ月</SelectItem>
                <SelectItem value="6mo">6ヶ月</SelectItem>
                <SelectItem value="1y">1年</SelectItem>
                <SelectItem value="2y">2年</SelectItem>
                <SelectItem value="5y">5年</SelectItem>
                <SelectItem value="10y">10年</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {nikkeiData && (
            <div className="flex gap-4 text-xs text-muted-foreground mt-1">
              <span>期間: {nikkeiData.period.changePercent >= 0 ? "+" : ""}{nikkeiData.period.changePercent.toFixed(2)}%</span>
              {nikkeiData.ma25 && <span>MA25: {nikkeiData.ma25.toLocaleString("ja-JP")}</span>}
              {nikkeiData.ma75 && <span>MA75: {nikkeiData.ma75.toLocaleString("ja-JP")}</span>}
              <span>{nikkeiData.latest.date}</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {nikkeiLoading ? (
            <Skeleton className="h-[250px] w-full" />
          ) : nikkeiData ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={nikkeiData.prices} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="nikkeiGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={nikkeiData.period.changePercent >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={nikkeiData.period.changePercent >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => {
                    if (["5y", "10y"].includes(nikkeiRange)) return v.substring(0, 4);
                    if (["1y", "2y"].includes(nikkeiRange)) return v.substring(5, 7) + "月";
                    return v.substring(5);
                  }}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => (v / 1000).toFixed(0) + "k"}
                  width={45}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(value: number) => [value.toLocaleString("ja-JP", { minimumFractionDigits: 2 }), "終値"]}
                  labelFormatter={(label: string) => label}
                />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={nikkeiData.period.changePercent >= 0 ? "#10b981" : "#ef4444"}
                  fill="url(#nikkeiGrad)"
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-muted-foreground">
              データを取得できませんでした
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">最近の取引</CardTitle>
          </CardHeader>
          <CardContent>
            {trades && trades.length > 0 ? (
              <div className="space-y-3">
                {trades.slice(0, 5).map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0" data-testid={`trade-row-${trade.id}`}>
                    <div className="flex items-center gap-3">
                      <Badge variant={trade.side === "buy" ? "default" : "destructive"}>
                        {trade.side === "buy" ? "買い" : "売り"}
                      </Badge>
                      <div>
                        <p className="font-medium text-sm">{trade.stockTicker}</p>
                        <p className="text-xs text-muted-foreground">{trade.quantity}株 @ {trade.price.toLocaleString("ja-JP")} 円</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">{trade.total.toLocaleString("ja-JP")} 円</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(trade.executedAt!).toLocaleDateString("ja-JP")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>取引履歴はありません</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">値動きランキング</CardTitle>
          </CardHeader>
          <CardContent>
            {stocks && stocks.length > 0 ? (
              <div className="space-y-3">
                {[...stocks]
                  .sort((a, b) => Math.abs((b.currentPrice - b.previousClose) / b.previousClose) - Math.abs((a.currentPrice - a.previousClose) / a.previousClose))
                  .slice(0, 5)
                  .map((stock) => {
                    const change = ((stock.currentPrice - stock.previousClose) / stock.previousClose * 100);
                    const isUp = change >= 0;
                    return (
                      <div key={stock.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0" data-testid={`mover-row-${stock.id}`}>
                        <div>
                          <p className="font-medium text-sm">{stock.ticker}</p>
                          <p className="text-xs text-muted-foreground">{stock.name}</p>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <span className="font-medium text-sm">{stock.currentPrice.toLocaleString("ja-JP")} 円</span>
                          <Badge variant={isUp ? "default" : "destructive"} className="min-w-[60px] justify-center">
                            {isUp ? "+" : ""}{change.toFixed(2)}%
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>銘柄データがありません</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {jquantsStatus && (
        <Card data-testid="card-jquants-status">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-primary" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">J-Quants API</span>
                {jquantsStatus.configured ? (
                  <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" data-testid="badge-jquants-status">接続済み</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs" data-testid="badge-jquants-status">未設定</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {jquantsStatus.configured ? "JPX公式データ接続済み" : "APIキーを設定すると公式データが利用可能になります"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {scheduler && (
        <Card data-testid="card-scheduler">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Timer className="h-5 w-5" />
                夜間バッチ処理
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{scheduler.enabled ? "有効" : "無効"}</span>
                <Switch
                  checked={scheduler.enabled}
                  onCheckedChange={(checked) => toggleScheduler.mutate(checked)}
                  data-testid="switch-scheduler"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">スケジュール</p>
                <p className="text-sm font-medium">{scheduler.schedule}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">次回実行予定</p>
                <p className="text-sm font-medium">
                  {new Date(scheduler.nextRunAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">前回実行</p>
                <p className="text-sm font-medium">
                  {scheduler.lastRunAt
                    ? new Date(scheduler.lastRunAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "未実行"
                  }
                </p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={scheduler.enabled ? "default" : "secondary"}>
                  {scheduler.enabled ? "自動実行ON" : "自動実行OFF"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  終値取得 → 日足指標計算 → 5分足データ蓄積 → 5分足指標計算
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">株価取得:</span>
                  <Badge variant={scheduler.fetchStatus === "running" ? "default" : scheduler.fetchStatus === "completed" ? "secondary" : "outline"} className="text-xs">
                    {scheduler.fetchStatus === "idle" ? "待機中" : scheduler.fetchStatus === "running" ? "実行中" : scheduler.fetchStatus === "completed" ? "完了" : "エラー"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">指標計算:</span>
                  <Badge variant={scheduler.indicatorStatus === "running" ? "default" : scheduler.indicatorStatus === "completed" ? "secondary" : "outline"} className="text-xs" data-testid="badge-indicator-status">
                    {scheduler.indicatorStatus === "idle" ? "待機中" : scheduler.indicatorStatus === "running" ? "実行中" : scheduler.indicatorStatus === "completed" ? "完了" : "エラー"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">5分足:</span>
                  <Badge variant={scheduler.intradayStatus === "running" ? "default" : scheduler.intradayStatus === "completed" ? "secondary" : "outline"} className="text-xs" data-testid="badge-intraday-status">
                    {scheduler.intradayStatus === "idle" ? "待機中" : scheduler.intradayStatus === "running" ? "実行中" : scheduler.intradayStatus === "completed" ? "完了" : "エラー"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">5分足指標:</span>
                  <Badge variant={scheduler.intradayIndicatorStatus === "running" ? "default" : scheduler.intradayIndicatorStatus === "completed" ? "secondary" : "outline"} className="text-xs" data-testid="badge-intraday-indicator-status">
                    {scheduler.intradayIndicatorStatus === "idle" ? "待機中" : scheduler.intradayIndicatorStatus === "running" ? "実行中" : scheduler.intradayIndicatorStatus === "completed" ? "完了" : "エラー"}
                  </Badge>
                </div>
              </div>
              {scheduler.indicatorProgress && scheduler.indicatorProgress.status === "running" && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>テクニカル指標計算中...</span>
                    <span>{scheduler.indicatorProgress.processed}/{scheduler.indicatorProgress.total}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all"
                      style={{ width: `${scheduler.indicatorProgress.total > 0 ? (scheduler.indicatorProgress.processed / scheduler.indicatorProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}
              {scheduler.indicatorProgress && scheduler.indicatorProgress.status === "completed" && (
                <p className="text-xs text-muted-foreground" data-testid="text-indicator-result">
                  {scheduler.indicatorProgress.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-intraday-data">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" />
              日中足データ蓄積（5分/10分/30分）
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                disabled={intradayProgress?.status === "running" || startIntradayFetch.isPending}
                onClick={() => startIntradayFetch.mutate("daily")}
                data-testid="button-intraday-daily"
              >
                当日分取得
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={intradayProgress?.status === "running" || startIntradayFetch.isPending}
                onClick={() => startIntradayFetch.mutate("seed")}
                data-testid="button-intraday-seed"
              >
                初回シード(60日)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={intradayProgress?.status === "running" || aggregateIntraday.isPending}
                onClick={() => aggregateIntraday.mutate()}
                data-testid="button-intraday-aggregate"
              >
                10分/30分足生成
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">保存済みバー数</p>
              <p className="text-sm font-medium" data-testid="text-intraday-bars">{intradayStats?.totalBars?.toLocaleString("ja-JP") ?? "0"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">対象銘柄数</p>
              <p className="text-sm font-medium" data-testid="text-intraday-tickers">{intradayStats?.distinctTickers?.toLocaleString("ja-JP") ?? "0"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">最古データ</p>
              <p className="text-sm font-medium" data-testid="text-intraday-earliest">
                {intradayStats?.earliestDate ? intradayStats.earliestDate.split("T")[0] : "なし"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">最新データ</p>
              <p className="text-sm font-medium" data-testid="text-intraday-latest">
                {intradayStats?.latestDate ? intradayStats.latestDate.split("T")[0] : "なし"}
              </p>
            </div>
          </div>
          {intradayProgress && intradayProgress.status === "running" && (
            <div className="mt-3 pt-3 border-t space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{intradayProgress.mode === "seed" ? "初回シード取得中..." : intradayProgress.mode === "aggregate" ? "10分/30分足生成中..." : "当日分取得中..."}</span>
                <span>{intradayProgress.processed}/{intradayProgress.total}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all"
                  style={{ width: `${intradayProgress.total > 0 ? (intradayProgress.processed / intradayProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{intradayProgress.message}</p>
            </div>
          )}
          {intradayProgress && intradayProgress.status === "completed" && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-muted-foreground" data-testid="text-intraday-result">{intradayProgress.message}</p>
            </div>
          )}
          <div className="mt-3 pt-3 border-t">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs">自動蓄積</Badge>
              <span className="text-xs text-muted-foreground">
                夜間バッチで毎日自動取得 ・ 120日間保持 ・ バックテスト時にDB優先使用
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
