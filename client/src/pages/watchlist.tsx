import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, StarOff, TrendingUp, TrendingDown, RefreshCw, LineChart } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import type { Stock } from "@shared/schema";

export default function Watchlist() {
  const { data: stocks, isLoading } = useQuery<Stock[]>({ queryKey: ["/api/stocks"] });
  const { toast } = useToast();

  const toggleWatch = useMutation({
    mutationFn: async ({ ticker, isWatched }: { ticker: string; isWatched: boolean }) => {
      await apiRequest("PATCH", `/api/stocks/${ticker}/watch`, { isWatched });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
    },
    onError: () => {
      toast({ title: "エラー", description: "ウォッチリストの更新に失敗しました", variant: "destructive" });
    },
  });

  const simulatePrices = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/simulate-prices");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: "価格更新完了", description: "市場価格のシミュレーションが完了しました" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48 mb-2" />
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const watchedStocks = stocks?.filter(s => s.isWatched) ?? [];
  const otherStocks = stocks?.filter(s => !s.isWatched) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">ウォッチリスト</h1>
          <p className="text-muted-foreground">日本株の株価をモニタリング</p>
        </div>
        <Button onClick={() => simulatePrices.mutate()} disabled={simulatePrices.isPending} data-testid="button-simulate-prices">
          <RefreshCw className={`h-4 w-4 mr-2 ${simulatePrices.isPending ? "animate-spin" : ""}`} />
          価格シミュレーション
        </Button>
      </div>

      {watchedStocks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            お気に入り
          </h2>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {watchedStocks.map((stock) => (
              <StockCard key={stock.id} stock={stock} onToggleWatch={toggleWatch} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">全銘柄</h2>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {otherStocks.map((stock) => (
            <StockCard key={stock.id} stock={stock} onToggleWatch={toggleWatch} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StockCard({ stock, onToggleWatch }: { stock: Stock; onToggleWatch: any }) {
  const change = stock.currentPrice - stock.previousClose;
  const changePercent = (change / stock.previousClose) * 100;
  const isUp = change >= 0;

  return (
    <Card className="hover-elevate" data-testid={`card-stock-${stock.ticker}`}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">{stock.ticker}</span>
              <Badge variant="secondary" className="text-xs">{stock.sector}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{stock.name}</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onToggleWatch.mutate({ ticker: stock.ticker, isWatched: !stock.isWatched })}
            data-testid={`button-watch-${stock.ticker}`}
          >
            {stock.isWatched ? (
              <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
            ) : (
              <StarOff className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-2xl font-bold" data-testid={`text-price-${stock.ticker}`}>
              {stock.currentPrice.toLocaleString("ja-JP")}
            </p>
            <p className="text-xs text-muted-foreground">円</p>
          </div>
          <div className="text-right">
            <div className={`flex items-center gap-1 text-sm font-medium ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
              {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {isUp ? "+" : ""}{change.toFixed(0)}
            </div>
            <Badge variant={isUp ? "default" : "destructive"} className="text-xs mt-1">
              {isUp ? "+" : ""}{changePercent.toFixed(2)}%
            </Badge>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>高値: {stock.dayHigh.toLocaleString("ja-JP")}</span>
          <span>安値: {stock.dayLow.toLocaleString("ja-JP")}</span>
          <span>出来高: {stock.volume.toLocaleString("ja-JP")}</span>
        </div>
        <div className="mt-3">
          <Link href={`/stocks/${stock.ticker}`}>
            <Button variant="outline" size="sm" className="w-full" data-testid={`button-chart-${stock.ticker}`}>
              <LineChart className="h-3.5 w-3.5 mr-1.5" />
              チャートを見る
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
