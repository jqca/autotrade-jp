import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Activity, Wallet, BarChart3, Zap } from "lucide-react";
import type { Stock, Strategy, Trade, PortfolioPosition } from "@shared/schema";

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
  const { data: stocks, isLoading: stocksLoading } = useQuery<Stock[]>({ queryKey: ["/api/stocks"] });
  const { data: strategies, isLoading: strategiesLoading } = useQuery<Strategy[]>({ queryKey: ["/api/strategies"] });
  const { data: trades, isLoading: tradesLoading } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { data: positions, isLoading: positionsLoading } = useQuery<PortfolioPosition[]>({ queryKey: ["/api/portfolio"] });

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
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Dashboard</h1>
        <p className="text-muted-foreground">Portfolio overview and trading activity</p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Portfolio Value"
          value={`${totalValue.toLocaleString("ja-JP")} JPY`}
          change={`${totalPnL >= 0 ? "+" : ""}${totalPnL.toLocaleString("ja-JP")} JPY (${pnlPercent}%)`}
          icon={Wallet}
          trend={totalPnL >= 0 ? "up" : "down"}
        />
        <StatCard
          title="Active Strategies"
          value={`${activeStrategies}`}
          change={`${strategies?.length ?? 0} total strategies`}
          icon={Zap}
          trend="neutral"
        />
        <StatCard
          title="Today's Trades"
          value={`${todayTrades}`}
          change={`${trades?.length ?? 0} total trades`}
          icon={Activity}
          trend="neutral"
        />
        <StatCard
          title="Holdings"
          value={`${positions?.length ?? 0} stocks`}
          icon={BarChart3}
          trend="neutral"
        />
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Trades</CardTitle>
          </CardHeader>
          <CardContent>
            {trades && trades.length > 0 ? (
              <div className="space-y-3">
                {trades.slice(0, 5).map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0" data-testid={`trade-row-${trade.id}`}>
                    <div className="flex items-center gap-3">
                      <Badge variant={trade.side === "buy" ? "default" : "destructive"}>
                        {trade.side === "buy" ? "Buy" : "Sell"}
                      </Badge>
                      <div>
                        <p className="font-medium text-sm">{trade.stockTicker}</p>
                        <p className="text-xs text-muted-foreground">{trade.quantity} shares @ {trade.price.toLocaleString("ja-JP")} JPY</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">{trade.total.toLocaleString("ja-JP")} JPY</p>
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
                <p>No trades yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Movers</CardTitle>
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
                          <span className="font-medium text-sm">{stock.currentPrice.toLocaleString("ja-JP")} JPY</span>
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
                <p>No stock data</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
