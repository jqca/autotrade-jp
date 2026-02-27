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
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Trade History</h1>
        <p className="text-muted-foreground">View all executed trades</p>
      </div>

      <Card>
        <CardContent className="pt-0">
          {trades && trades.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Total</TableHead>
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
                          {trade.side === "buy" ? "Buy" : "Sell"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {trade.price.toLocaleString("ja-JP")} JPY
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {trade.quantity.toLocaleString("ja-JP")}
                      </TableCell>
                      <TableCell className="text-right font-medium font-mono">
                        {trade.total.toLocaleString("ja-JP")} JPY
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-16">
              <Activity className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="font-semibold mb-1">No trades yet</h3>
              <p className="text-muted-foreground text-sm">
                Trades will appear here when your strategies execute
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
