import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Star, StarOff, TrendingUp, TrendingDown, RefreshCw, LineChart, Search, Download, ChevronLeft, ChevronRight, Loader2, Zap } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useState, useCallback, useEffect } from "react";
import type { Stock } from "@shared/schema";

interface FetchAllProgress {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  updated: number;
  errors: number;
  message: string;
}

const PAGE_SIZE = 30;

interface SearchResult {
  stocks: Stock[];
  total: number;
}

export default function Watchlist() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [marketFilter, setMarketFilter] = useState<"all" | "JP" | "US">("all");
  const { toast } = useToast();

  const debounceTimer = useCallback(
    (() => {
      let timer: ReturnType<typeof setTimeout>;
      return (value: string) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          setDebouncedQuery(value);
          setPage(0);
        }, 300);
      };
    })(),
    []
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debounceTimer(value);
  };

  const { data: watchedStocks } = useQuery<Stock[]>({
    queryKey: ["/api/stocks?watched"],
  });

  const marketParam = marketFilter !== "all" ? `&market=${marketFilter}` : "";
  const { data: searchResult, isLoading: searchLoading } = useQuery<SearchResult>({
    queryKey: [`/api/stocks?search=1&q=${encodeURIComponent(debouncedQuery)}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${marketParam}`],
    enabled: showSearch,
  });

  const totalPages = searchResult ? Math.ceil(searchResult.total / PAGE_SIZE) : 0;

  const toggleWatch = useMutation({
    mutationFn: async ({ ticker, isWatched }: { ticker: string; isWatched: boolean }) => {
      await apiRequest("PATCH", `/api/stocks/${ticker}/watch`, { isWatched });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stocks?watched"] });
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

  const importStocks = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/import-stocks");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
      toast({
        title: "銘柄インポート完了",
        description: `${data.imported}銘柄をJPXリストからインポートしました`,
      });
      setShowSearch(true);
    },
    onError: () => {
      toast({ title: "エラー", description: "銘柄のインポートに失敗しました", variant: "destructive" });
    },
  });

  const fetchPrices = useMutation({
    mutationFn: async (tickers: string[]) => {
      const res = await apiRequest("POST", "/api/fetch-prices", { tickers });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
      toast({
        title: "株価取得完了",
        description: `${data.updated}/${data.total}銘柄の株価を取得しました`,
      });
    },
    onError: () => {
      toast({ title: "エラー", description: "株価の取得に失敗しました", variant: "destructive" });
    },
  });

  const [fetchAllRunning, setFetchAllRunning] = useState(false);
  const [fetchUSRunning, setFetchUSRunning] = useState(false);

  const { data: fetchProgress } = useQuery<FetchAllProgress>({
    queryKey: ["/api/fetch-all-prices/progress"],
    refetchInterval: fetchAllRunning ? 2000 : false,
  });

  const { data: fetchUSProgress } = useQuery<FetchAllProgress>({
    queryKey: ["/api/fetch-us-prices/progress"],
    refetchInterval: fetchUSRunning ? 2000 : false,
  });

  useEffect(() => {
    if (fetchProgress?.status === "running") {
      setFetchAllRunning(true);
    } else if (fetchProgress?.status === "completed" || fetchProgress?.status === "error") {
      if (fetchAllRunning) {
        setFetchAllRunning(false);
        queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stocks?watched"] });
      }
    }
  }, [fetchProgress?.status]);

  useEffect(() => {
    if (fetchUSProgress?.status === "running") {
      setFetchUSRunning(true);
    } else if (fetchUSProgress?.status === "completed" || fetchUSProgress?.status === "error") {
      if (fetchUSRunning) {
        setFetchUSRunning(false);
        queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
      }
    }
  }, [fetchUSProgress?.status]);

  const startFetchAll = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/fetch-all-prices");
    },
    onSuccess: () => {
      setFetchAllRunning(true);
      queryClient.invalidateQueries({ queryKey: ["/api/fetch-all-prices/progress"] });
      toast({ title: "全銘柄株価取得開始", description: "バックグラウンドで日本株の株価を取得しています..." });
    },
    onError: (error: any) => {
      toast({ title: "エラー", description: error.message || "株価取得の開始に失敗しました", variant: "destructive" });
    },
  });

  const importUSStocksMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/import-us-stocks");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
      toast({ title: "米国株インポート完了", description: `${data.imported}銘柄をインポートしました` });
      setShowSearch(true);
      setMarketFilter("US");
    },
    onError: () => {
      toast({ title: "エラー", description: "米国株のインポートに失敗しました", variant: "destructive" });
    },
  });

  const startFetchUS = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/fetch-us-prices");
    },
    onSuccess: () => {
      setFetchUSRunning(true);
      queryClient.invalidateQueries({ queryKey: ["/api/fetch-us-prices/progress"] });
      toast({ title: "米国株価取得開始", description: "バックグラウンドで米国株の株価を取得しています..." });
    },
    onError: (error: any) => {
      toast({ title: "エラー", description: error.message || "米国株価取得の開始に失敗しました", variant: "destructive" });
    },
  });

  const fetchCurrentPagePrices = () => {
    if (searchResult?.stocks) {
      const tickers = searchResult.stocks
        .filter(s => s.currentPrice === 0)
        .map(s => s.ticker);
      if (tickers.length === 0) {
        toast({ title: "情報", description: "表示中の全銘柄は既に株価が取得済みです" });
        return;
      }
      fetchPrices.mutate(tickers);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">ウォッチリスト</h1>
          <p className="text-muted-foreground">日本株・米国株の株価をモニタリング</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => simulatePrices.mutate()} disabled={simulatePrices.isPending} variant="outline" data-testid="button-simulate-prices">
            <RefreshCw className={`h-4 w-4 mr-2 ${simulatePrices.isPending ? "animate-spin" : ""}`} />
            価格シミュレーション
          </Button>
          <Button onClick={() => importStocks.mutate()} disabled={importStocks.isPending} variant="outline" data-testid="button-import-jp-stocks">
            {importStocks.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            日本株インポート
          </Button>
          <Button onClick={() => importUSStocksMutation.mutate()} disabled={importUSStocksMutation.isPending} variant="outline" data-testid="button-import-us-stocks">
            {importUSStocksMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            米国株インポート
          </Button>
          <Button
            onClick={() => startFetchAll.mutate()}
            disabled={startFetchAll.isPending || fetchAllRunning}
            variant="default"
            data-testid="button-fetch-jp-prices"
          >
            {fetchAllRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            日本株価取得
          </Button>
          <Button
            onClick={() => startFetchUS.mutate()}
            disabled={startFetchUS.isPending || fetchUSRunning}
            variant="default"
            data-testid="button-fetch-us-prices"
          >
            {fetchUSRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            米国株価取得
          </Button>
        </div>
      </div>

      {fetchProgress && fetchProgress.status !== "idle" && (
        <Card data-testid="card-fetch-progress">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-medium">
                {fetchAllRunning ? "日本株価取得中..." : fetchProgress.status === "completed" ? "日本株価取得完了" : "エラー"}
              </span>
              <span className="text-xs text-muted-foreground">
                {fetchProgress.processed.toLocaleString("ja-JP")} / {fetchProgress.total.toLocaleString("ja-JP")}
              </span>
            </div>
            <Progress
              value={fetchProgress.total > 0 ? (fetchProgress.processed / fetchProgress.total) * 100 : 0}
              className="h-2 mb-2"
            />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{fetchProgress.message}</span>
              <span>成功: {fetchProgress.updated.toLocaleString("ja-JP")} / エラー: {fetchProgress.errors.toLocaleString("ja-JP")}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {fetchUSProgress && fetchUSProgress.status !== "idle" && (
        <Card data-testid="card-us-fetch-progress">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-medium">
                {fetchUSRunning ? "米国株価取得中..." : fetchUSProgress.status === "completed" ? "米国株価取得完了" : "エラー"}
              </span>
              <span className="text-xs text-muted-foreground">
                {fetchUSProgress.processed.toLocaleString("ja-JP")} / {fetchUSProgress.total.toLocaleString("ja-JP")}
              </span>
            </div>
            <Progress
              value={fetchUSProgress.total > 0 ? (fetchUSProgress.processed / fetchUSProgress.total) * 100 : 0}
              className="h-2 mb-2"
            />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{fetchUSProgress.message}</span>
              <span>成功: {fetchUSProgress.updated.toLocaleString("ja-JP")} / エラー: {fetchUSProgress.errors.toLocaleString("ja-JP")}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {(watchedStocks?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            お気に入り ({watchedStocks!.length}銘柄)
          </h2>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {watchedStocks!.map((stock) => (
              <StockCard key={stock.id} stock={stock} onToggleWatch={toggleWatch} />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            全銘柄検索
            {searchResult && (
              <Badge variant="secondary">{searchResult.total.toLocaleString("ja-JP")}銘柄</Badge>
            )}
          </h2>
          {!showSearch && (
            <Button variant="outline" onClick={() => setShowSearch(true)} data-testid="button-show-search">
              <Search className="h-4 w-4 mr-2" />
              銘柄を検索
            </Button>
          )}
        </div>

        {showSearch && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                {(["all", "JP", "US"] as const).map((m) => (
                  <Button
                    key={m}
                    variant={marketFilter === m ? "default" : "ghost"}
                    size="sm"
                    onClick={() => { setMarketFilter(m); setPage(0); }}
                    data-testid={`button-market-${m.toLowerCase()}`}
                  >
                    {m === "all" ? "全て" : m === "JP" ? "🇯🇵 日本株" : "🇺🇸 米国株"}
                  </Button>
                ))}
              </div>
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="銘柄コード・企業名・セクターで検索..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchCurrentPagePrices}
                disabled={fetchPrices.isPending}
                data-testid="button-fetch-prices"
              >
                {fetchPrices.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                )}
                株価取得
              </Button>
            </div>

            {searchLoading ? (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <Card key={i}><CardContent className="pt-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
                ))}
              </div>
            ) : searchResult?.stocks.length === 0 ? (
              <div className="text-center py-12">
                <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">該当する銘柄が見つかりません</p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {searchResult?.stocks.map((stock) => (
                    <StockCard key={stock.id} stock={stock} onToggleWatch={toggleWatch} />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      前へ
                    </Button>
                    <span className="text-sm text-muted-foreground" data-testid="text-page-info">
                      {page + 1} / {totalPages} ページ
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      data-testid="button-next-page"
                    >
                      次へ
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StockCard({ stock, onToggleWatch }: { stock: Stock; onToggleWatch: any }) {
  const hasPrice = stock.currentPrice > 0 && stock.previousClose > 0;
  const change = hasPrice ? stock.currentPrice - stock.previousClose : 0;
  const changePercent = hasPrice ? (change / stock.previousClose) * 100 : 0;
  const isUp = change >= 0;
  const isUS = (stock as any).market === "US";
  const currency = isUS ? "$" : "¥";

  return (
    <Card className="hover-elevate" data-testid={`card-stock-${stock.ticker}`}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">{stock.ticker}</span>
              {isUS && <Badge variant="outline" className="text-xs border-blue-400 text-blue-600">US</Badge>}
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

        {hasPrice ? (
          <>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-2xl font-bold" data-testid={`text-price-${stock.ticker}`}>
                  {isUS ? `$${stock.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `¥${stock.currentPrice.toLocaleString("ja-JP")}`}
                </p>
                <p className="text-xs text-muted-foreground">{isUS ? "USD" : "円"}</p>
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
          </>
        ) : (
          <div className="py-2">
            <p className="text-sm text-muted-foreground">株価未取得</p>
            <p className="text-xs text-muted-foreground mt-1">「株価取得」ボタンで最新価格を取得できます</p>
          </div>
        )}

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
