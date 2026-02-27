import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Wallet, TrendingUp, TrendingDown } from "lucide-react";
import type { PortfolioPosition } from "@shared/schema";

export default function Portfolio() {
  const { data: positions, isLoading } = useQuery<PortfolioPosition[]>({ queryKey: ["/api/portfolio"] });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const totalValue = positions?.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0) ?? 0;
  const totalCost = positions?.reduce((sum, p) => sum + p.avgPrice * p.quantity, 0) ?? 0;
  const totalPnL = totalValue - totalCost;
  const pnlPercent = totalCost > 0 ? ((totalPnL / totalCost) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">ポートフォリオ</h1>
        <p className="text-muted-foreground">保有銘柄と運用パフォーマンス</p>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">評価額合計</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-value">{totalValue.toLocaleString("ja-JP")} 円</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">取得原価合計</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-cost">{totalCost.toLocaleString("ja-JP")} 円</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">含み損益</CardTitle>
            {totalPnL >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalPnL >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`} data-testid="text-total-pnl">
              {totalPnL >= 0 ? "+" : ""}{totalPnL.toLocaleString("ja-JP")} 円
            </div>
            <p className={`text-xs mt-1 ${totalPnL >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
              {totalPnL >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>保有銘柄</CardTitle>
        </CardHeader>
        <CardContent>
          {positions && positions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>銘柄</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">平均取得価格</TableHead>
                    <TableHead className="text-right">現在値</TableHead>
                    <TableHead className="text-right">評価額</TableHead>
                    <TableHead className="text-right">損益</TableHead>
                    <TableHead className="w-[100px]">構成比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos) => {
                    const value = pos.currentPrice * pos.quantity;
                    const cost = pos.avgPrice * pos.quantity;
                    const pnl = value - cost;
                    const pnlPct = ((pnl / cost) * 100);
                    const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;
                    const isUp = pnl >= 0;

                    return (
                      <TableRow key={pos.id} data-testid={`position-row-${pos.stockTicker}`}>
                        <TableCell className="font-medium">{pos.stockTicker}</TableCell>
                        <TableCell className="text-right font-mono">{pos.quantity.toLocaleString("ja-JP")}</TableCell>
                        <TableCell className="text-right font-mono">{pos.avgPrice.toLocaleString("ja-JP")}</TableCell>
                        <TableCell className="text-right font-mono">{pos.currentPrice.toLocaleString("ja-JP")}</TableCell>
                        <TableCell className="text-right font-mono font-medium">{value.toLocaleString("ja-JP")}</TableCell>
                        <TableCell className="text-right">
                          <div className={`font-mono font-medium ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                            {isUp ? "+" : ""}{pnl.toLocaleString("ja-JP")}
                          </div>
                          <Badge variant={isUp ? "default" : "destructive"} className="text-xs mt-0.5">
                            {isUp ? "+" : ""}{pnlPct.toFixed(2)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={weight} className="h-2" />
                            <span className="text-xs text-muted-foreground min-w-[35px]">{weight.toFixed(0)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-16">
              <Wallet className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="font-semibold mb-1">保有銘柄がありません</h3>
              <p className="text-muted-foreground text-sm">
                取引が実行されると、ここにポートフォリオが表示されます
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
