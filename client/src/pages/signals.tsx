import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ArrowUpCircle, ArrowDownCircle, MinusCircle, TrendingUp, TrendingDown, Search, BarChart3 } from "lucide-react";
import { Link } from "wouter";
import { useState, useMemo } from "react";
import type { Stock, TechnicalIndicator } from "@shared/schema";

type FilterType = "strong_buy" | "buy" | "strong_sell" | "sell" | "neutral" | "all";

const filterOptions: { value: FilterType; label: string }[] = [
  { value: "strong_buy", label: "強い買いシグナル" },
  { value: "buy", label: "買いシグナル（全て）" },
  { value: "strong_sell", label: "強い売りシグナル" },
  { value: "sell", label: "売りシグナル（全て）" },
  { value: "neutral", label: "様子見" },
  { value: "all", label: "全銘柄" },
];

function SignalIcon({ signal }: { signal: string | null }) {
  if (signal === "buy") return <ArrowUpCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  if (signal === "sell") return <ArrowDownCircle className="h-4 w-4 text-red-500 dark:text-red-400" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
}

function TrendBadge({ trend, label }: { trend: string | null; label: string }) {
  const variant = trend === "buy" ? "default" : trend === "sell" ? "destructive" : "secondary";
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

export default function Signals() {
  const [filter, setFilter] = useState<FilterType>("strong_buy");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: indicators, isLoading: indicatorsLoading } = useQuery<TechnicalIndicator[]>({
    queryKey: ["/api/indicators"],
  });

  const { data: stocks } = useQuery<Stock[]>({
    queryKey: ["/api/stocks"],
  });

  const stockMap = useMemo(() => {
    const map = new Map<string, Stock>();
    stocks?.forEach(s => map.set(s.ticker, s));
    return map;
  }, [stocks]);

  const filtered = useMemo(() => {
    if (!indicators) return [];

    let result = indicators.filter(ind => {
      const buyIndicators = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend].filter(t => t === "buy").length;
      const sellIndicators = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend].filter(t => t === "sell").length;
      switch (filter) {
        case "strong_buy":
          return ind.overallSignal === "buy" && buyIndicators >= 3;
        case "buy":
          return ind.overallSignal === "buy";
        case "strong_sell":
          return ind.overallSignal === "sell" && sellIndicators >= 3;
        case "sell":
          return ind.overallSignal === "sell";
        case "neutral":
          return ind.overallSignal === "neutral";
        case "all":
          return true;
      }
    });

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(ind => {
        const stock = stockMap.get(ind.ticker);
        return ind.ticker.toLowerCase().includes(q) ||
          (stock && stock.name.toLowerCase().includes(q)) ||
          (stock && stock.sector.toLowerCase().includes(q));
      });
    }

    return result.sort((a, b) => {
      const stockA = stockMap.get(a.ticker);
      const stockB = stockMap.get(b.ticker);
      if (!stockA || !stockB) return 0;
      const changeA = stockA.previousClose > 0 ? (stockA.currentPrice - stockA.previousClose) / stockA.previousClose : 0;
      const changeB = stockB.previousClose > 0 ? (stockB.currentPrice - stockB.previousClose) / stockB.previousClose : 0;
      return changeB - changeA;
    });
  }, [indicators, filter, searchQuery, stockMap]);

  const counts = useMemo(() => {
    if (!indicators) return { buy: 0, strongBuy: 0, sell: 0, strongSell: 0 };
    let buy = 0, strongBuy = 0, sell = 0, strongSell = 0;
    for (const ind of indicators) {
      const buyC = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend].filter(t => t === "buy").length;
      const sellC = [ind.macdTrend, ind.rsiTrend, ind.maTrend, ind.bbTrend].filter(t => t === "sell").length;
      if (ind.overallSignal === "buy") { buy++; if (buyC >= 3) strongBuy++; }
      if (ind.overallSignal === "sell") { sell++; if (sellC >= 3) strongSell++; }
    }
    return { buy, strongBuy, sell, strongSell };
  }, [indicators]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">売買シグナル</h1>
        <p className="text-muted-foreground">テクニカル指標に基づく売買シグナル一覧</p>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card className="cursor-pointer" onClick={() => setFilter("strong_buy")} data-testid="card-strong-buy-count">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-xs text-muted-foreground">強い買い</p>
                <p className="text-2xl font-bold" data-testid="text-strong-buy-count">{counts.strongBuy}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("buy")} data-testid="card-buy-count">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-xs text-muted-foreground">買い全体</p>
                <p className="text-2xl font-bold" data-testid="text-buy-count">{counts.buy}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("strong_sell")} data-testid="card-strong-sell-count">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <ArrowDownCircle className="h-5 w-5 text-red-500 dark:text-red-400" />
              <div>
                <p className="text-xs text-muted-foreground">強い売り</p>
                <p className="text-2xl font-bold" data-testid="text-strong-sell-count">{counts.strongSell}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("sell")} data-testid="card-sell-count">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500 dark:text-red-400" />
              <div>
                <p className="text-xs text-muted-foreground">売り全体</p>
                <p className="text-2xl font-bold" data-testid="text-sell-count">{counts.sell}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="銘柄コード・名前・セクターで検索..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-signals"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger className="w-[200px]" data-testid="select-signal-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filterOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-xs" data-testid="badge-result-count">
          {filtered.length}件
        </Badge>
      </div>

      {indicatorsLoading ? (
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : !indicators || indicators.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <h3 className="font-semibold mb-1">テクニカル指標データがありません</h3>
            <p className="text-muted-foreground text-sm">
              ダッシュボードから夜間バッチを実行するか、手動で指標計算を実行してください
            </p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Search className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <h3 className="font-semibold mb-1">該当する銘柄がありません</h3>
            <p className="text-muted-foreground text-sm">
              フィルターや検索条件を変更してください
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((ind) => {
            const stock = stockMap.get(ind.ticker);
            const change = stock && stock.previousClose > 0
              ? ((stock.currentPrice - stock.previousClose) / stock.previousClose * 100)
              : 0;
            const isUp = change >= 0;

            return (
              <Link key={ind.ticker} href={`/stocks/${ind.ticker}`}>
                <Card className="cursor-pointer" data-testid={`signal-row-${ind.ticker}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <SignalIcon signal={ind.overallSignal} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm" data-testid={`text-ticker-${ind.ticker}`}>{ind.ticker}</span>
                            {stock && <span className="text-sm text-muted-foreground truncate">{stock.name}</span>}
                          </div>
                          {stock && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-sm font-medium">{stock.currentPrice.toLocaleString("ja-JP")} 円</span>
                              <span className={`text-xs ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                                {isUp ? "+" : ""}{change.toFixed(2)}%
                              </span>
                              {stock.sector && <Badge variant="outline" className="text-xs">{stock.sector}</Badge>}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <TrendBadge trend={ind.macdTrend} label={`MACD`} />
                          <TrendBadge trend={ind.rsiTrend} label={`RSI${ind.rsiValue != null ? ` ${ind.rsiValue.toFixed(0)}` : ""}`} />
                          <TrendBadge trend={ind.maTrend} label="MA" />
                          <TrendBadge trend={ind.bbTrend} label="BB" />
                        </div>
                        <Badge
                          variant={ind.overallSignal === "buy" ? "default" : ind.overallSignal === "sell" ? "destructive" : "secondary"}
                          className="min-w-[100px] justify-center"
                          data-testid={`badge-overall-${ind.ticker}`}
                        >
                          {ind.overallLabel}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {indicators && indicators.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          最終計算: {indicators[0]?.calculatedAt
            ? new Date(indicators[0].calculatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
            : "不明"
          }
        </p>
      )}
    </div>
  );
}
