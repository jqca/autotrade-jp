import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { Stock } from "@shared/schema";

interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const rangeOptions = [
  { value: "1mo", label: "1ヶ月" },
  { value: "3mo", label: "3ヶ月" },
  { value: "6mo", label: "6ヶ月" },
  { value: "1y", label: "1年" },
  { value: "2y", label: "2年" },
  { value: "5y", label: "5年" },
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover border rounded-md p-3 text-sm shadow-md">
      <p className="font-medium mb-1">{data.date}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">始値:</span>
        <span className="font-mono text-right">{data.open.toLocaleString("ja-JP")}</span>
        <span className="text-muted-foreground">高値:</span>
        <span className="font-mono text-right">{data.high.toLocaleString("ja-JP")}</span>
        <span className="text-muted-foreground">安値:</span>
        <span className="font-mono text-right">{data.low.toLocaleString("ja-JP")}</span>
        <span className="text-muted-foreground">終値:</span>
        <span className="font-mono text-right font-medium">{data.close.toLocaleString("ja-JP")}</span>
        <span className="text-muted-foreground">出来高:</span>
        <span className="font-mono text-right">{data.volume.toLocaleString("ja-JP")}</span>
      </div>
    </div>
  );
}

export default function StockDetail() {
  const params = useParams<{ ticker: string }>();
  const ticker = params.ticker!;
  const [range, setRange] = useState("6mo");

  const { data: stocks, isLoading: stocksLoading } = useQuery<Stock[]>({ queryKey: ["/api/stocks"] });
  const stock = stocks?.find(s => s.ticker === ticker);

  const { data: history, isLoading: historyLoading, error } = useQuery<HistoricalPrice[]>({
    queryKey: [`/api/stocks/${ticker}/history?range=${range}`],
  });

  const change = stock ? stock.currentPrice - stock.previousClose : 0;
  const changePercent = stock ? (change / stock.previousClose) * 100 : 0;
  const isUp = change >= 0;

  const chartData = history?.map(p => ({
    ...p,
    dateLabel: new Date(p.date).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }),
  })) ?? [];

  const firstPrice = chartData.length > 0 ? chartData[0].close : 0;
  const lastPrice = chartData.length > 0 ? chartData[chartData.length - 1].close : 0;
  const periodChange = lastPrice - firstPrice;
  const periodChangePercent = firstPrice > 0 ? (periodChange / firstPrice) * 100 : 0;
  const isPeriodUp = periodChange >= 0;

  const minPrice = chartData.length > 0 ? Math.min(...chartData.map(d => d.low)) : 0;
  const maxPrice = chartData.length > 0 ? Math.max(...chartData.map(d => d.high)) : 0;
  const priceRange = maxPrice - minPrice;
  const yMin = Math.floor(minPrice - priceRange * 0.05);
  const yMax = Math.ceil(maxPrice + priceRange * 0.05);

  if (stocksLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  if (!stocksLoading && stocks && !stock) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <Link href="/watchlist">
            <Button size="icon" variant="ghost" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">銘柄が見つかりません</h1>
        </div>
        <p className="text-muted-foreground">ティッカー「{ticker}」の銘柄は登録されていません。</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/watchlist">
          <Button size="icon" variant="ghost" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
              {ticker}
            </h1>
            {stock && <Badge variant="secondary">{stock.sector}</Badge>}
          </div>
          {stock && <p className="text-muted-foreground">{stock.name}</p>}
        </div>
      </div>

      {stock && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">現在値</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-current-price">
                {stock.currentPrice.toLocaleString("ja-JP")} 円
              </div>
              <div className={`flex items-center gap-1 text-xs mt-1 ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {isUp ? "+" : ""}{change.toFixed(0)} ({isUp ? "+" : ""}{changePercent.toFixed(2)}%)
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">前日終値</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stock.previousClose.toLocaleString("ja-JP")} 円</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">日中高値 / 安値</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">
                {stock.dayHigh.toLocaleString("ja-JP")} / {stock.dayLow.toLocaleString("ja-JP")}
              </div>
              <p className="text-xs text-muted-foreground mt-1">円</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">出来高</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stock.volume.toLocaleString("ja-JP")}</div>
              <p className="text-xs text-muted-foreground mt-1">株</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg">株価チャート</CardTitle>
              {chartData.length > 0 && (
                <p className={`text-sm mt-1 ${isPeriodUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                  期間変動: {isPeriodUp ? "+" : ""}{periodChange.toFixed(0)} 円 ({isPeriodUp ? "+" : ""}{periodChangePercent.toFixed(2)}%)
                </p>
              )}
            </div>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[140px]" data-testid="select-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rangeOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <Skeleton className="h-[350px] w-full" />
          ) : error ? (
            <div className="text-center py-16">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="font-semibold mb-1">データを取得できませんでした</h3>
              <p className="text-muted-foreground text-sm">しばらくしてから再試行してください</p>
            </div>
          ) : chartData.length > 0 ? (
            <div className="h-[350px]" data-testid="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={isPeriodUp ? "hsl(150, 70%, 40%)" : "hsl(0, 70%, 50%)"} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={isPeriodUp ? "hsl(150, 70%, 40%)" : "hsl(0, 70%, 50%)"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    interval="preserveStartEnd"
                    tickCount={8}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    tickFormatter={(v) => v.toLocaleString("ja-JP")}
                    width={70}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke={isPeriodUp ? "hsl(150, 70%, 40%)" : "hsl(0, 70%, 50%)"}
                    fill="url(#priceGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-16">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">チャートデータがありません</p>
            </div>
          )}
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">期間サマリー</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">期間高値</p>
                <p className="text-lg font-bold font-mono">{maxPrice.toLocaleString("ja-JP")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">期間安値</p>
                <p className="text-lg font-bold font-mono">{minPrice.toLocaleString("ja-JP")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">期間始値</p>
                <p className="text-lg font-bold font-mono">{firstPrice.toLocaleString("ja-JP")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">期間終値</p>
                <p className="text-lg font-bold font-mono">{lastPrice.toLocaleString("ja-JP")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
