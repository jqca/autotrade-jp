import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, TrendingUp, TrendingDown, BarChart3, ArrowUpCircle, ArrowDownCircle, MinusCircle } from "lucide-react";
import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import type { Stock } from "@shared/schema";
import {
  calcMovingAverages,
  calcBollingerBands,
  calcRSI,
  calcMACD,
  calcSignals,
  type SignalType,
} from "@/lib/technical-indicators";

interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const rangeOptions = [
  { value: "5m", label: "5分足" },
  { value: "10m", label: "10分足" },
  { value: "30m", label: "30分足" },
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
        <span className="font-mono text-right">{data.open?.toLocaleString("ja-JP")}</span>
        <span className="text-muted-foreground">高値:</span>
        <span className="font-mono text-right">{data.high?.toLocaleString("ja-JP")}</span>
        <span className="text-muted-foreground">安値:</span>
        <span className="font-mono text-right">{data.low?.toLocaleString("ja-JP")}</span>
        <span className="text-muted-foreground">終値:</span>
        <span className="font-mono text-right font-medium">{data.close?.toLocaleString("ja-JP")}</span>
        <span className="text-muted-foreground">出来高:</span>
        <span className="font-mono text-right">{data.volume?.toLocaleString("ja-JP")}</span>
      </div>
    </div>
  );
}

function MACDTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover border rounded-md p-2 text-xs shadow-md">
      <p className="font-medium mb-1">{data.date}</p>
      <div className="space-y-0.5">
        {data.macd != null && <p>MACD: <span className="font-mono">{data.macd.toFixed(2)}</span></p>}
        {data.signal != null && <p>シグナル: <span className="font-mono">{data.signal.toFixed(2)}</span></p>}
        {data.histogram != null && <p>ヒストグラム: <span className="font-mono">{data.histogram.toFixed(2)}</span></p>}
      </div>
    </div>
  );
}

function RSITooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover border rounded-md p-2 text-xs shadow-md">
      <p className="font-medium mb-1">{data.date}</p>
      {data.rsi != null && <p>RSI: <span className="font-mono">{data.rsi.toFixed(2)}</span></p>}
    </div>
  );
}

function BollingerTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover border rounded-md p-2 text-xs shadow-md">
      <p className="font-medium mb-1">{data.date}</p>
      <div className="space-y-0.5">
        <p>終値: <span className="font-mono">{data.close?.toLocaleString("ja-JP")}</span></p>
        {data.upper != null && <p>上限: <span className="font-mono">{data.upper.toLocaleString("ja-JP")}</span></p>}
        {data.middle != null && <p>中央: <span className="font-mono">{data.middle.toLocaleString("ja-JP")}</span></p>}
        {data.lower != null && <p>下限: <span className="font-mono">{data.lower.toLocaleString("ja-JP")}</span></p>}
      </div>
    </div>
  );
}

function SignalBadge({ signal, label }: { signal: SignalType; label: string }) {
  const variants: Record<SignalType, { variant: "default" | "destructive" | "secondary"; icon: typeof ArrowUpCircle }> = {
    buy: { variant: "default", icon: ArrowUpCircle },
    sell: { variant: "destructive", icon: ArrowDownCircle },
    neutral: { variant: "secondary", icon: MinusCircle },
  };
  const { variant, icon: Icon } = variants[signal];
  return (
    <Badge variant={variant} className="gap-1" data-testid={`badge-signal-${signal}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export default function StockDetail() {
  const params = useParams<{ ticker: string }>();
  const ticker = params.ticker!;
  const [range, setRange] = useState("6mo");

  const { data: stocks, isLoading: stocksLoading } = useQuery<Stock[]>({ queryKey: ["/api/stocks"] });
  const stock = stocks?.find(s => s.ticker === ticker);

  const isIntraday = range === "5m" || range === "10m" || range === "30m";
  const intradayLabel = range === "5m" ? "5分足" : range === "10m" ? "10分足" : "30分足";
  const historyUrl = isIntraday
    ? `/api/stocks/${ticker}/history?range=1d&interval=${range}`
    : `/api/stocks/${ticker}/history?range=${range}`;

  const { data: history, isLoading: historyLoading, error } = useQuery<HistoricalPrice[]>({
    queryKey: [historyUrl],
  });

  const change = stock ? stock.currentPrice - stock.previousClose : 0;
  const changePercent = stock ? (change / stock.previousClose) * 100 : 0;
  const isUp = change >= 0;

  const chartData = history?.map(p => ({
    ...p,
    dateLabel: isIntraday
      ? new Date(p.date).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
      : new Date(p.date).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }),
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

  const indicators = useMemo(() => {
    if (!history || history.length < 2) return null;
    const prices = history.map(p => ({ date: p.date, close: p.close, high: p.high, low: p.low }));
    const ma = calcMovingAverages(prices);
    const bb = calcBollingerBands(prices);
    const rsi = calcRSI(prices);
    const macd = calcMACD(prices);
    const signals = calcSignals(prices);

    const fmt = (date: string) => isIntraday
      ? new Date(date).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
      : new Date(date).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
    const maChart = ma.map(d => ({ ...d, dateLabel: fmt(d.date) }));
    const bbChart = bb.map(d => ({ ...d, dateLabel: fmt(d.date) }));
    const rsiChart = rsi.map(d => ({ ...d, dateLabel: fmt(d.date) }));
    const macdChart = macd.map(d => ({ ...d, dateLabel: fmt(d.date) }));

    return { ma: maChart, bb: bbChart, rsi: rsiChart, macd: macdChart, signals };
  }, [history, isIntraday]);

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

  const bbYDomain = (() => {
    if (!indicators?.bb) return [0, 0];
    const valid = indicators.bb.filter(d => d.upper != null && d.lower != null);
    if (valid.length === 0) return [yMin, yMax];
    const lo = Math.min(...valid.map(d => d.lower!));
    const hi = Math.max(...valid.map(d => d.upper!));
    const r = hi - lo;
    return [Math.floor(lo - r * 0.05), Math.ceil(hi + r * 0.05)];
  })();

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
              <CardTitle className="text-lg">{isIntraday ? `${intradayLabel}チャート` : "株価チャート"}</CardTitle>
              {chartData.length > 0 && (
                <p className={`text-sm mt-1 ${isPeriodUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                  {isIntraday ? "日中" : "期間"}変動: {isPeriodUp ? "+" : ""}{periodChange.toFixed(0)} 円 ({isPeriodUp ? "+" : ""}{periodChangePercent.toFixed(2)}%)
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

      {indicators && (
        <>
          <Card data-testid="card-signals">
            <CardHeader>
              <CardTitle className="text-lg">売買シグナル分析</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium text-muted-foreground">総合判断:</span>
                  <SignalBadge signal={indicators.signals.overall.signal} label={indicators.signals.overall.label} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2 p-3 rounded-lg border">
                  <p className="text-xs font-medium text-muted-foreground">MACD</p>
                  <SignalBadge signal={indicators.signals.macd.signal} label={indicators.signals.macd.label} />
                </div>
                <div className="space-y-2 p-3 rounded-lg border">
                  <p className="text-xs font-medium text-muted-foreground">RSI {indicators.signals.rsi.value != null && <span className="font-mono">({indicators.signals.rsi.value.toFixed(1)})</span>}</p>
                  <SignalBadge signal={indicators.signals.rsi.signal} label={indicators.signals.rsi.label} />
                </div>
                <div className="space-y-2 p-3 rounded-lg border">
                  <p className="text-xs font-medium text-muted-foreground">移動平均</p>
                  <SignalBadge signal={indicators.signals.ma.signal} label={indicators.signals.ma.label} />
                </div>
                <div className="space-y-2 p-3 rounded-lg border">
                  <p className="text-xs font-medium text-muted-foreground">ボリンジャーバンド</p>
                  <SignalBadge signal={indicators.signals.bollinger.signal} label={indicators.signals.bollinger.label} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ma">
            <CardHeader>
              <CardTitle className="text-lg">{isIntraday ? "移動平均線（5本・25本・75本）" : "移動平均線（5日・25日・75日）"}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={indicators.ma} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" tickCount={8} />
                    <YAxis domain={[yMin, yMax]} tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString("ja-JP")} width={70} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="close" stroke="hsl(210, 60%, 50%)" strokeWidth={1.5} dot={false} name="終値" />
                    <Line type="monotone" dataKey="ma5" stroke="hsl(30, 90%, 55%)" strokeWidth={1.5} dot={false} name="5日MA" connectNulls />
                    <Line type="monotone" dataKey="ma25" stroke="hsl(280, 70%, 55%)" strokeWidth={1.5} dot={false} name="25日MA" connectNulls />
                    <Line type="monotone" dataKey="ma75" stroke="hsl(150, 70%, 40%)" strokeWidth={1.5} dot={false} name="75日MA" connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(210, 60%, 50%)" }}></span>終値</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(30, 90%, 55%)" }}></span>5日</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(280, 70%, 55%)" }}></span>25日</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(150, 70%, 40%)" }}></span>75日</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-bollinger">
            <CardHeader>
              <CardTitle className="text-lg">{isIntraday ? "ボリンジャーバンド（20本・±2σ）" : "ボリンジャーバンド（20日・±2σ）"}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={indicators.bb} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" tickCount={8} />
                    <YAxis domain={bbYDomain} tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString("ja-JP")} width={70} />
                    <Tooltip content={<BollingerTooltip />} />
                    <Area type="monotone" dataKey="upper" stroke="none" fill="hsl(210, 60%, 50%)" fillOpacity={0.1} connectNulls />
                    <Area type="monotone" dataKey="lower" stroke="none" fill="transparent" fillOpacity={0} connectNulls />
                    <Line type="monotone" dataKey="upper" stroke="hsl(210, 60%, 60%)" strokeWidth={1} strokeDasharray="4 2" dot={false} name="+2σ" connectNulls />
                    <Line type="monotone" dataKey="middle" stroke="hsl(210, 60%, 50%)" strokeWidth={1} dot={false} name="中央" connectNulls />
                    <Line type="monotone" dataKey="lower" stroke="hsl(210, 60%, 60%)" strokeWidth={1} strokeDasharray="4 2" dot={false} name="-2σ" connectNulls />
                    <Line type="monotone" dataKey="close" stroke="hsl(0, 70%, 50%)" strokeWidth={1.5} dot={false} name="終値" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(0, 70%, 50%)" }}></span>終値</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block border-dashed border-t" style={{ borderColor: "hsl(210, 60%, 60%)" }}></span>±2σ</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(210, 60%, 50%)" }}></span>中央線</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-macd">
            <CardHeader>
              <CardTitle className="text-lg">MACD（12, 26, 9）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={indicators.macd} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" tickCount={8} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(0)} width={60} />
                    <Tooltip content={<MACDTooltip />} />
                    <ReferenceLine y={0} stroke="hsl(0, 0%, 50%)" strokeDasharray="3 3" />
                    <Bar dataKey="histogram" name="ヒストグラム" maxBarSize={4}>
                      {indicators.macd.map((entry, i) => (
                        <Cell key={i} fill={entry.histogram != null && entry.histogram >= 0 ? "hsl(150, 70%, 45%)" : "hsl(0, 70%, 50%)"} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="macd" stroke="hsl(210, 80%, 55%)" strokeWidth={1.5} dot={false} name="MACD" connectNulls />
                    <Line type="monotone" dataKey="signal" stroke="hsl(30, 90%, 55%)" strokeWidth={1.5} dot={false} name="シグナル" connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(210, 80%, 55%)" }}></span>MACD</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(30, 90%, 55%)" }}></span>シグナル</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 inline-block" style={{ backgroundColor: "hsl(150, 70%, 45%)" }}></span>ヒストグラム(+)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 inline-block" style={{ backgroundColor: "hsl(0, 70%, 50%)" }}></span>ヒストグラム(-)</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-rsi">
            <CardHeader>
              <CardTitle className="text-lg">RSI（14日）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={indicators.rsi} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" tickCount={8} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} ticks={[0, 30, 50, 70, 100]} width={40} />
                    <Tooltip content={<RSITooltip />} />
                    <ReferenceLine y={70} stroke="hsl(0, 70%, 50%)" strokeDasharray="4 2" label={{ value: "70", position: "right", fontSize: 10 }} />
                    <ReferenceLine y={30} stroke="hsl(150, 70%, 40%)" strokeDasharray="4 2" label={{ value: "30", position: "right", fontSize: 10 }} />
                    <defs>
                      <linearGradient id="rsiGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(280, 70%, 55%)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="hsl(280, 70%, 55%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="rsi" stroke="hsl(280, 70%, 55%)" fill="url(#rsiGradient)" strokeWidth={1.5} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: "hsl(280, 70%, 55%)" }}></span>RSI</span>
                <span className="text-muted-foreground">70以上: 買われすぎ</span>
                <span className="text-muted-foreground">30以下: 売られすぎ</span>
              </div>
            </CardContent>
          </Card>
        </>
      )}

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
