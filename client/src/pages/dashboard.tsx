import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TrendingUp, TrendingDown, Activity, Wallet, BarChart3, Zap, Clock, Timer } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Stock, Strategy, Trade, PortfolioPosition } from "@shared/schema";

interface SchedulerStatus {
  enabled: boolean;
  schedule: string;
  lastRunAt: string | null;
  nextRunAt: string;
  fetchStatus: string;
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

export default function Dashboard() {
  const { data: stocksRaw, isLoading: stocksLoading } = useQuery<Stock[]>({ queryKey: ["/api/stocks"] });
  const stocks = stocksRaw?.filter(s => s.currentPrice > 0 && s.previousClose > 0);
  const { data: strategies, isLoading: strategiesLoading } = useQuery<Strategy[]>({ queryKey: ["/api/strategies"] });
  const { data: trades, isLoading: tradesLoading } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { data: positions, isLoading: positionsLoading } = useQuery<PortfolioPosition[]>({ queryKey: ["/api/portfolio"] });
  const { data: scheduler } = useQuery<SchedulerStatus>({ queryKey: ["/api/scheduler"] });

  const toggleScheduler = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PATCH", "/api/scheduler", { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler"] });
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
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-2">
                <Badge variant={scheduler.enabled ? "default" : "secondary"}>
                  {scheduler.enabled ? "自動実行ON" : "自動実行OFF"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  取引終了後に全銘柄の終値を自動取得します
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
