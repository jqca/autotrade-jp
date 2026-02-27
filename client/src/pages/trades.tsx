import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity } from "lucide-react";
import type { Trade } from "@shared/schema";

export default function Trades() {
  const { data: trades, isLoading } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">取引履歴</h1>
        <p className="text-muted-foreground">全ての約定済み取引を表示</p>
      </div>

      <Card>
        <CardContent className="pt-0">
          {trades && trades.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日時</TableHead>
                    <TableHead>銘柄</TableHead>
                    <TableHead>売買</TableHead>
                    <TableHead className="text-right">価格</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">約定金額</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((trade) => (
                    <TableRow key={trade.id} data-testid={`trade-row-${trade.id}`}>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(trade.executedAt!).toLocaleString("ja-JP", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="font-medium">{trade.stockTicker}</TableCell>
                      <TableCell>
                        <Badge variant={trade.side === "buy" ? "default" : "destructive"}>
                          {trade.side === "buy" ? "買い" : "売り"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {trade.price.toLocaleString("ja-JP")} 円
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {trade.quantity.toLocaleString("ja-JP")}
                      </TableCell>
                      <TableCell className="text-right font-medium font-mono">
                        {trade.total.toLocaleString("ja-JP")} 円
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-16">
              <Activity className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="font-semibold mb-1">取引履歴がありません</h3>
              <p className="text-muted-foreground text-sm">
                戦略が実行されると、ここに取引が表示されます
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
