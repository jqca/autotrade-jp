import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PlayCircle, StopCircle, Trophy, TrendingDown, BarChart3, Trash2, Loader2,
  CheckCircle, XCircle, Settings2, GitCompare, List, Banknote, TrendingUp,
  Clock, AlertTriangle, Activity, Zap, Brain, Atom, Shield, ArrowUpDown,
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BacktestResult, BacktestRun as BacktestRunConfig } from "@shared/schema";

interface BacktestRun {
  runId: string;
  count: number;
  wins: number;
  losses: number;
  createdAt: string | null;
  config: BacktestRunConfig | null;
}

interface BacktestProgress {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  signals: number;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string;
  runId: string | null;
  params: BacktestParams | null;
  phase?: string;
  aiFiltered?: number;
  quantumSelected?: number;
  skippedByCapital?: number;
  capitalRemaining?: number;
}

interface BacktestParams {
  targetPercent: number;
  minBuyIndicators: number;
  requiredIndicators?: string[];
  rsiMin: number;
  rsiMax: number;
  requireMaBuy: boolean;
  simDays: number;
  timeframe: string;
  label: string;
  startDate?: string;
  endDate?: string;
  useAi?: boolean;
  useQuantum?: boolean;
  aiThreshold?: number;
  stopLossPercent?: number;
  maxHoldDays?: number;
  minVolume?: number;
  requireUptrend?: boolean;
  dynamicTarget?: boolean;
  requireMacdCrossover?: boolean;
  requireRsiReversal?: boolean;
  requireVolumeSurge?: boolean;
  volumeSurgeRatio?: number;
  maxGapPercent?: number;
  trailingStop?: boolean;
  trailingStopPercent?: number;
  confirmDays?: number;
  minSignalScore?: number;
  requireDailyConfirm?: boolean;
  dailyMinBuyIndicators?: number;
  dailyMinSignalScore?: number;
  initialCapital?: number;
  market?: string;
}

function TrendBadge({ trend, label, active = true }: { trend: string | null; label: string; active?: boolean }) {
  const variant = active
    ? (trend === "buy" ? "default" : trend === "sell" ? "destructive" : "secondary")
    : "outline";
  return <Badge variant={variant} className={`text-xs ${!active ? "opacity-40" : ""}`}>{label}</Badge>;
}

function RunLabel({ run }: { run: BacktestRun }) {
  const dateStr = run.createdAt
    ? new Date(run.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const cfg = run.config;
  const tfLabels: Record<string, string> = { "5m": "5分足", "10m": "10分足", "30m": "30分足", "1d": "日足" };
  const tfLabel = cfg?.timeframe ? (tfLabels[cfg.timeframe] || cfg.timeframe) : "日足";
  const aiLabel = cfg?.useAi || cfg?.useQuantum
    ? ` [${cfg.useAi ? "AI" : ""}${cfg.useAi && cfg.useQuantum ? "+" : ""}${cfg.useQuantum ? "量子" : ""}]`
    : "";
  const paramStr = cfg
    ? `${tfLabel} 目標${cfg.targetPercent}% ${cfg.requiredIndicators?.length ? "必須:" + (cfg.requiredIndicators as string[]).map((i: string) => i.toUpperCase()).join("/") : "指標" + cfg.minBuyIndicators + "+"}${aiLabel}`
    : "";
  return <span>{dateStr} {paramStr} ({run.count}件)</span>;
}

function PhaseIndicator({ phase }: { phase?: string }) {
  if (!phase) return null;
  const labels: Record<string, { label: string; icon: typeof Brain }> = {
    scan: { label: "シグナルスキャン", icon: Activity },
    ai_quantum: { label: "AI/量子分析", icon: Brain },
    capital: { label: "資金シミュレーション", icon: Banknote },
    save: { label: "結果保存", icon: CheckCircle },
  };
  const info = labels[phase] || { label: phase, icon: Activity };
  const Icon = info.icon;
  return (
    <Badge variant="outline" className="text-xs gap-1" data-testid="badge-phase">
      <Icon className="h-3 w-3" />
      {info.label}
    </Badge>
  );
}

interface AppSetting {
  key: string;
  value: string;
}

export default function Backtest() {
  const [selectedRun, setSelectedRun] = useState<string>("latest");
  const [polling, setPolling] = useState(false);
  const [activeTab, setActiveTab] = useState("results");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const { toast } = useToast();

  const { data: appSettings } = useQuery<AppSetting[]>({ queryKey: ["/api/settings"] });
  const settingsMap = (appSettings || []).reduce((acc, s) => { acc[s.key] = s.value; return acc; }, {} as Record<string, string>);

  const [targetPercent, setTargetPercent] = useState(1.0);
  const [requiredIndicators, setRequiredIndicators] = useState<string[]>(["macd"]);
  const [rsiMin, setRsiMin] = useState(25);
  const [rsiMax, setRsiMax] = useState(75);
  const [simDays, setSimDays] = useState(200);
  const [timeframe, setTimeframe] = useState("1d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [useQuantum, setUseQuantum] = useState(false);
  const [aiThreshold, setAiThreshold] = useState(0.5);
  const [stopLossPercent, setStopLossPercent] = useState(1);
  const [maxHoldDays, setMaxHoldDays] = useState(3);
  const [minVolume, setMinVolume] = useState(50);
  const [minVolatility, setMinVolatility] = useState(0);
  const [excludePriceMin, setExcludePriceMin] = useState(500);
  const [excludePriceMax, setExcludePriceMax] = useState(1000);
  const [excludePriceEnabled, setExcludePriceEnabled] = useState(false);
  const [excludeComboNBN, setExcludeComboNBN] = useState(false);
  const [excludeComboNNN, setExcludeComboNNN] = useState(false);
  const [excludeComboNSN, setExcludeComboNSN] = useState(false);
  const [tradingStartHour, setTradingStartHour] = useState(9);
  const [tradingEndHour, setTradingEndHour] = useState(10);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    if (appSettings && !settingsLoaded) {
      const startH = parseInt(settingsMap["trading_start_hour"] || "9", 10);
      const endH = parseInt(settingsMap["trading_end_hour"] || "10", 10);
      if (!isNaN(startH)) setTradingStartHour(startH);
      if (!isNaN(endH)) setTradingEndHour(endH);
      setSettingsLoaded(true);
    }
  }, [appSettings, settingsLoaded]);
  const [requireUptrend, setRequireUptrend] = useState(false);
  const [dynamicTarget, setDynamicTarget] = useState(false);
  const [requireMacdCrossover, setRequireMacdCrossover] = useState(false);
  const [requireRsiReversal, setRequireRsiReversal] = useState(false);
  const [requireVolumeSurge, setRequireVolumeSurge] = useState(false);
  const [volumeSurgeRatio, setVolumeSurgeRatio] = useState(1.5);
  const [maxGapPercent, setMaxGapPercent] = useState(1.5);
  const [trailingStop, setTrailingStop] = useState(true);
  const [trailingStopPercent, setTrailingStopPercent] = useState(1.5);
  const [confirmDays, setConfirmDays] = useState(1);
  const [minSignalScore, setMinSignalScore] = useState(20);
  const [requireDailyConfirm, setRequireDailyConfirm] = useState(false);
  const [dailyMinBuyIndicators, setDailyMinBuyIndicators] = useState(2);
  const [dailyMinSignalScore, setDailyMinSignalScore] = useState(0);
  const [initialCapital, setInitialCapital] = useState(1000000);
  const [market, setMarket] = useState<string>("JP");
  const [showAdvanced, setShowAdvanced] = useState(true);

  const [now, setNow] = useState(Date.now());
  const { data: progressData } = useQuery<BacktestProgress>({
    queryKey: ["/api/backtest/progress"],
    refetchInterval: polling ? 1000 : 5000,
  });

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [polling]);

  useEffect(() => {
    if (progressData?.status === "running") {
      setPolling(true);
    } else if (polling && progressData?.status === "completed") {
      setPolling(false);
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/runs"] });
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/backtest/results") });
    } else if (polling && progressData?.status === "cancelled") {
      setPolling(false);
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/runs"] });
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/backtest/results") });
      toast({ title: "バックテスト中止", description: progressData.message });
    } else if (polling && progressData?.status !== "running") {
      setPolling(false);
    }
  }, [progressData?.status, polling]);

  const { data: runs, isLoading: runsLoading } = useQuery<BacktestRun[]>({
    queryKey: ["/api/backtest/runs"],
  });

  const activeRunId = selectedRun === "latest" ? runs?.[0]?.runId : selectedRun;

  const { data: results, isLoading: resultsLoading } = useQuery<BacktestResult[]>({
    queryKey: [`/api/backtest/results?runId=${activeRunId}`],
    enabled: !!activeRunId,
  });

  const isIntraday = timeframe !== "1d";
  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/backtest/run", {
      targetPercent,
      minBuyIndicators: requiredIndicators.length,
      requiredIndicators,
      rsiMin,
      rsiMax,
      requireMaBuy: requiredIndicators.includes("ma"),
      simDays,
      timeframe,
      label: "",
      ...(isIntraday && startDate ? { startDate } : {}),
      ...(isIntraday && endDate ? { endDate } : {}),
      useAi,
      useQuantum,
      aiThreshold,
      stopLossPercent,
      maxHoldDays,
      minVolume,
      requireUptrend,
      dynamicTarget,
      requireMacdCrossover,
      requireRsiReversal,
      requireVolumeSurge,
      volumeSurgeRatio,
      maxGapPercent,
      trailingStop,
      trailingStopPercent,
      confirmDays,
      minSignalScore,
      requireDailyConfirm,
      dailyMinBuyIndicators,
      dailyMinSignalScore,
      initialCapital,
      market,
      rsiExcludeMin: 0,
      rsiExcludeMax: 0,
      minBarVolume: 0,
      minVolatility,
      tradingStartHour,
      tradingEndHour,
      excludePriceMin: excludePriceEnabled ? excludePriceMin : 0,
      excludePriceMax: excludePriceEnabled ? excludePriceMax : 0,
      excludeCombos: [
        ...(excludeComboNBN ? ["neutral/buy/neutral"] : []),
        ...(excludeComboNNN ? ["neutral/neutral/neutral"] : []),
        ...(excludeComboNSN ? ["neutral/sell/neutral"] : []),
      ],
    }),
    onSuccess: () => {
      setPolling(true);
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/progress"] });
      toast({ title: "バックテスト開始", description: `シミュレーションを実行中です...${useAi || useQuantum ? " (AI/量子分析有効)" : ""}` });
    },
    onError: (err: any) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/backtest/cancel"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/progress"] });
    },
    onError: (err: any) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("DELETE", `/api/backtest/runs/${runId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/runs"] });
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/backtest/results") });
      toast({ title: "削除完了", description: "バックテスト結果を削除しました" });
    },
  });

  const stats = useMemo(() => {
    if (!results || results.length === 0) return null;
    const runCfg = runs?.find(r => r.runId === activeRunId)?.config;
    const isUS = runCfg?.label?.includes("米国株") ?? false;
    const UNIT_SHARES = isUS ? 1 : 100;
    const wins = results.filter(r => r.isWin).length;
    const losses = results.length - wins;
    const winRate = Math.round((wins / results.length) * 10000) / 100;
    const totalPL = results.reduce((sum, r) => sum + r.profitLossPercent, 0);
    const avgPL = Math.round((totalPL / results.length) * 100) / 100;
    const totalWinPL = results.filter(r => r.isWin).reduce((s, r) => s + r.profitLossPercent, 0);
    const totalLossPL = Math.abs(results.filter(r => !r.isWin).reduce((s, r) => s + r.profitLossPercent, 0));
    const profitFactor = totalLossPL > 0 ? Math.round((totalWinPL / totalLossPL) * 100) / 100 : totalWinPL > 0 ? Infinity : 0;
    const hasAi = results.some(r => r.aiScore != null);
    const hasQuantum = results.some(r => r.quantumSelected != null);
    const totalProfitYen = Math.round(results.reduce((sum, r) => sum + r.profitLoss * UNIT_SHARES, 0));
    const totalInvestment = Math.round(results.reduce((sum, r) => sum + r.buyPrice * UNIT_SHARES, 0));
    const avgProfitYen = Math.round(totalProfitYen / results.length);
    const maxWinYen = Math.round(Math.max(...results.map(r => r.profitLoss * UNIT_SHARES)));
    const maxLossYen = Math.round(Math.min(...results.map(r => r.profitLoss * UNIT_SHARES)));
    const hasCapitalTracking = results.some(r => r.capitalBefore != null);
    const capitalStart = hasCapitalTracking ? results[0]?.capitalBefore ?? null : null;
    const capitalEnd = hasCapitalTracking ? results[results.length - 1]?.capitalAfter ?? null : null;
    const capitalReturn = capitalStart != null && capitalEnd != null && capitalStart > 0
      ? Math.round(((capitalEnd - capitalStart) / capitalStart) * 10000) / 100
      : null;
    return { wins, losses, winRate, avgPL, total: results.length, profitFactor, hasAi, hasQuantum, totalProfitYen, totalInvestment, avgProfitYen, maxWinYen, maxLossYen, hasCapitalTracking, capitalStart, capitalEnd, capitalReturn, isUS };
  }, [results, runs, activeRunId]);

  const comparisonData = useMemo(() => {
    if (!runs || runs.length < 2) return null;
    return runs.map(run => {
      const winRate = run.count > 0 ? Math.round((run.wins / run.count) * 10000) / 100 : 0;
      return { ...run, winRate };
    });
  }, [runs]);

  const capitalChartData = useMemo(() => {
    if (!results || results.length === 0) return null;
    if (!results.some(r => r.capitalAfter != null)) return null;
    const sorted = [...results]
      .filter(r => r.capitalAfter != null)
      .sort((a, b) => a.buyDate.localeCompare(b.buyDate));
    if (sorted.length === 0) return null;
    const initialCap = sorted[0].capitalBefore ?? sorted[0].capitalAfter!;
    const points: { date: string; capital: number; label: string }[] = [
      { date: sorted[0].buyDate, capital: Math.round(initialCap), label: "開始" },
    ];
    for (const r of sorted) {
      points.push({
        date: r.sellDate || r.buyDate,
        capital: Math.round(r.capitalAfter!),
        label: `${r.ticker} ${r.profitLossPercent >= 0 ? "+" : ""}${r.profitLossPercent.toFixed(2)}%`,
      });
    }
    return { points, initialCap: Math.round(initialCap) };
  }, [results]);

  const isRunning = progressData?.status === "running";
  const activeRunConfig = runs?.find(r => r.runId === activeRunId)?.config;

  const aiQuantumSummary = useMemo(() => {
    if (!activeRunConfig?.aiQuantumSummary) return null;
    try {
      return JSON.parse(activeRunConfig.aiQuantumSummary);
    } catch {
      return null;
    }
  }, [activeRunConfig]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">バックテスト</h1>
          <p className="text-muted-foreground text-sm">条件を変えて複数パターンのシミュレーションを比較</p>
        </div>
      </div>

      {isRunning && progressData && (() => {
        const pct = progressData.total > 0 ? Math.min((progressData.processed / progressData.total) * 100, 100) : 0;
        const elapsed = progressData.startedAt ? Math.max(0, Math.floor((now - progressData.startedAt) / 1000)) : 0;
        const elapsedMin = Math.floor(elapsed / 60);
        const elapsedSec = elapsed % 60;
        const speed = elapsed > 0 ? (progressData.processed / elapsed).toFixed(1) : "0";
        const remaining = elapsed > 0 && progressData.processed > 0
          ? Math.max(0, Math.ceil((progressData.total - progressData.processed) / (progressData.processed / elapsed)))
          : null;
        const remainingMin = remaining != null ? Math.floor(remaining / 60) : 0;
        const remainingSec = remaining != null ? remaining % 60 : 0;
        return (
          <Card data-testid="card-backtest-progress" className="border-primary/30 shadow-md">
            <CardContent className="pt-5 pb-4 px-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  <Activity className="h-4 w-4 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold" data-testid="text-progress-title">バックテスト実行中</h3>
                      <PhaseIndicator phase={progressData.phase} />
                    </div>
                    <span className="text-lg font-bold text-primary tabular-nums" data-testid="text-progress-pct">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate" data-testid="text-progress-message">
                    {progressData.message}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Progress value={pct} className="h-3" />
                <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                  <span data-testid="text-progress-count">
                    {progressData.processed.toLocaleString()} / {progressData.total.toLocaleString()} 銘柄
                  </span>
                  <span data-testid="text-remaining-count">残り {progressData.total - progressData.processed} 銘柄</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <Clock className="h-3 w-3" />
                    <span className="text-[10px] font-medium">経過時間</span>
                  </div>
                  <p className="text-sm font-semibold tabular-nums" data-testid="text-elapsed-time">
                    {elapsedMin > 0 ? `${elapsedMin}分${elapsedSec}秒` : `${elapsedSec}秒`}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <Clock className="h-3 w-3" />
                    <span className="text-[10px] font-medium">残り時間</span>
                  </div>
                  <p className="text-sm font-semibold tabular-nums" data-testid="text-remaining-time">
                    {remaining != null
                      ? remainingMin > 0 ? `約${remainingMin}分${remainingSec}秒` : `約${remainingSec}秒`
                      : "計算中..."}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <Zap className="h-3 w-3" />
                    <span className="text-[10px] font-medium">シグナル</span>
                  </div>
                  <p className="text-sm font-semibold text-primary tabular-nums" data-testid="text-signal-count">
                    {progressData.signals}件
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="text-[10px] font-medium">エラー</span>
                  </div>
                  <p className={`text-sm font-semibold tabular-nums ${progressData.errors > 0 ? "text-destructive" : ""}`} data-testid="text-error-count">
                    {progressData.errors}件
                  </p>
                </div>
              </div>

              {(progressData.aiFiltered != null || progressData.quantumSelected != null || progressData.skippedByCapital != null) && (
                <div className="flex items-center gap-4 text-xs border-t pt-3 flex-wrap">
                  {progressData.aiFiltered != null && (
                    <div className="flex items-center gap-1.5">
                      <Brain className="h-3 w-3 text-sky-500" />
                      <span>AI除外: {progressData.aiFiltered}件</span>
                    </div>
                  )}
                  {progressData.quantumSelected != null && (
                    <div className="flex items-center gap-1.5">
                      <Atom className="h-3 w-3 text-purple-500" />
                      <span>量子選択: {progressData.quantumSelected}件</span>
                    </div>
                  )}
                  {progressData.skippedByCapital != null && (
                    <div className="flex items-center gap-1.5">
                      <Banknote className="h-3 w-3 text-amber-500" />
                      <span>資金不足スキップ: {progressData.skippedByCapital}件</span>
                    </div>
                  )}
                  {progressData.capitalRemaining != null && (
                    <div className="flex items-center gap-1.5">
                      <Banknote className="h-3 w-3 text-emerald-500" />
                      <span>最終資金: {progressData.params?.market === "US" ? `$${progressData.capitalRemaining.toLocaleString("en-US")}` : `${(progressData.capitalRemaining / 10000).toFixed(1)}万円`}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-3 w-3" />
                    <span data-testid="text-processing-speed">処理速度: {speed} 銘柄/秒</span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                    data-testid="button-cancel-backtest"
                  >
                    <StopCircle className="h-3.5 w-3.5 mr-1" />
                    {cancelMutation.isPending ? "中止中..." : "中止"}
                  </Button>
                </div>
                {progressData.params && (
                  <div className="flex items-center gap-1.5 flex-wrap justify-end" data-testid="progress-params-badges">
                    <Badge variant="outline" className="text-[10px] h-5" data-testid="badge-progress-market">
                      {progressData.params.market === "US" ? "US米国株" : "JP日本株"}
                    </Badge>
                    <Badge variant={progressData.params.timeframe !== "1d" ? "default" : "outline"} className="text-[10px] h-5" data-testid="badge-progress-timeframe">
                      {({"5m":"5分足","10m":"10分足","30m":"30分足","1d":"日足"} as Record<string,string>)[progressData.params.timeframe] || progressData.params.timeframe}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] h-5" data-testid="badge-progress-target">目標{progressData.params.targetPercent}%</Badge>
                    {progressData.params.useAi && (
                      <Badge className="text-[10px] h-5 bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300" data-testid="badge-progress-ai">AI</Badge>
                    )}
                    {progressData.params.useQuantum && (
                      <Badge className="text-[10px] h-5 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" data-testid="badge-progress-quantum">量子</Badge>
                    )}
                    {progressData.params.initialCapital && progressData.params.initialCapital > 0 && (
                      <Badge variant="outline" className="text-[10px] h-5 border-emerald-300 text-emerald-700 dark:text-emerald-400" data-testid="badge-progress-capital">
                        資金{(progressData.params.initialCapital / 10000).toFixed(0)}万
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="results" data-testid="tab-results">
            <List className="h-4 w-4 mr-1.5" />結果
          </TabsTrigger>
          <TabsTrigger value="config" data-testid="tab-config">
            <Settings2 className="h-4 w-4 mr-1.5" />条件設定
          </TabsTrigger>
          {runs && runs.length >= 2 && (
            <TabsTrigger value="compare" data-testid="tab-compare">
              <GitCompare className="h-4 w-4 mr-1.5" />比較
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="config" className="space-y-4 mt-4">
          <Card data-testid="card-ai-quantum-config">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="h-5 w-5 text-sky-500" />
                <Atom className="h-5 w-5 text-purple-500" />
                AI / 量子 適材適所モード
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                有効にすると、AIがシグナルの勝率を予測し、量子コンピュータが最適なポートフォリオを選択します。
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-sky-500" />
                      <Label className="font-medium">AIシグナルスコアリング</Label>
                    </div>
                    <Switch
                      checked={useAi}
                      onCheckedChange={setUseAi}
                      data-testid="switch-use-ai"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">GradientBoostingで各シグナルの勝率を予測し、低確率シグナルを除外</p>
                  {useAi && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-xs">AIフィルター閾値</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[aiThreshold]}
                          onValueChange={([v]) => setAiThreshold(v)}
                          min={0.3}
                          max={0.8}
                          step={0.05}
                          className="flex-1"
                          data-testid="slider-ai-threshold"
                        />
                        <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-ai-threshold">
                          {(aiThreshold * 100).toFixed(0)}%
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">AI予測勝率がこの値以上のシグナルのみ採用</p>
                    </div>
                  )}
                </div>

                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Atom className="h-4 w-4 text-purple-500" />
                      <Label className="font-medium">量子ポートフォリオ最適化</Label>
                    </div>
                    <Switch
                      checked={useQuantum}
                      onCheckedChange={setUseQuantum}
                      data-testid="switch-use-quantum"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">QAOA量子アルゴリズムで同日シグナルから最適な組み合わせを選択</p>
                  {useQuantum && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Shield className="h-3 w-3" />
                        <span>量子VaRリスク推定も自動実行されます</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {(useAi || useQuantum) && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Zap className="h-4 w-4 text-amber-500 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <p className="font-medium">適材適所パイプライン</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">Phase1: シグナルスキャン</Badge>
                        <span>→</span>
                        {useAi && <Badge className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300">Phase2: AI勝率予測</Badge>}
                        {useQuantum && <Badge className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">Phase3: 量子最適化+VaR</Badge>}
                        <span>→</span>
                        <Badge variant="outline" className="text-[10px]">結果保存</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings2 className="h-5 w-5" />バックテスト条件設定
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3 pb-2 border-b">
                <Label className="text-sm font-medium">対象市場</Label>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant={market === "JP" ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setMarket("JP"); setInitialCapital(1000000); setMinVolume(100000); }}
                    data-testid="button-market-jp"
                  >
                    JP 日本株（TSE）
                  </Button>
                  <Button
                    variant={market === "US" ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setMarket("US"); setInitialCapital(10000); setMinVolume(100000); }}
                    data-testid="button-market-us"
                  >
                    US 米国株（NYSE/NASDAQ）
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {market === "JP"
                    ? "TSE上場の日本株を対象にバックテストを行います（売買単位: 100株）"
                    : "NYSE/NASDAQ上場の米国株を対象にバックテストを行います（売買単位: 1株）"}
                </p>
              </div>
              <div className="space-y-3 pb-2 border-b">
                <Label className="text-sm font-medium">時間足</Label>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant={timeframe === "1d" ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setTimeframe("1d"); setSimDays(200); }}
                    data-testid="button-timeframe-1d"
                  >
                    日足（過去2年）
                  </Button>
                  <Button
                    variant={timeframe === "5m" ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setTimeframe("5m"); setSimDays(60); }}
                    data-testid="button-timeframe-5m"
                  >
                    5分足（過去60日）
                  </Button>
                  <Button
                    variant={timeframe === "10m" ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setTimeframe("10m"); setSimDays(60); }}
                    data-testid="button-timeframe-10m"
                  >
                    10分足（過去60日）
                  </Button>
                  <Button
                    variant={timeframe === "30m" ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setTimeframe("30m"); setSimDays(60); }}
                    data-testid="button-timeframe-30m"
                  >
                    30分足（過去60日）
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {timeframe === "1d"
                    ? "過去2年分の日足データでスイングトレードシミュレーションを行います"
                    : `過去60日分の${timeframe === "5m" ? "5" : timeframe === "10m" ? "10" : "30"}分足データでデイトレシミュレーションを行います`}
                </p>
                {isIntraday && (
                  <div className="mt-3 pt-3 border-t">
                    <Label className="text-sm font-medium mb-2 block">日付範囲（任意）</Label>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">開始日</Label>
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-[160px] h-8 text-sm"
                          data-testid="input-start-date"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">終了日</Label>
                        <Input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-[160px] h-8 text-sm"
                          data-testid="input-end-date"
                        />
                      </div>
                      {(startDate || endDate) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setStartDate(""); setEndDate(""); }}
                          className="text-xs h-8"
                          data-testid="button-clear-dates"
                        >
                          クリア
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {startDate || endDate
                        ? `指定期間: ${startDate || "最古"}〜${endDate || "最新"} のデータでシミュレーション`
                        : "未指定の場合はシミュレーション日数に基づいて自動的に範囲を決定します"}
                    </p>
                  </div>
                )}
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-3">
                  <Label className="text-sm font-medium">利確目標 (%)</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[targetPercent]}
                      onValueChange={([v]) => setTargetPercent(v)}
                      min={0.3}
                      max={3.0}
                      step={0.1}
                      className="flex-1"
                      data-testid="slider-target-percent"
                    />
                    <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-target-percent">
                      {targetPercent.toFixed(1)}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">当日高値が始値+目標%に達したら利確（勝ち）</p>
                </div>

                <div className="space-y-3 sm:col-span-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">必須買い指標</Label>
                    <Badge variant="secondary" className="text-[10px] h-5" data-testid="text-required-indicators-count">
                      {requiredIndicators.length}/4 選択中
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">チェックした指標が全て「買い」の場合のみエントリー（未選択＝制限なし）</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {([
                      { key: "macd", label: "MACD", desc: "MACDラインがシグナル線より上（クロス時+30pt）" },
                      { key: "rsi", label: "RSI", desc: "RSI値が30以下（売られすぎ＝反発期待）" },
                      { key: "ma", label: "MA（移動平均）", desc: "MA5がMA25をGC、または価格>MA5>MA25の上昇配列" },
                      { key: "bb", label: "BB（ボリンジャー）", desc: "価格がバンド下限以下（反発期待）" },
                    ] as const).map(ind => (
                      <label
                        key={ind.key}
                        className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors"
                        data-testid={`checkbox-indicator-${ind.key}`}
                      >
                        <Checkbox
                          checked={requiredIndicators.includes(ind.key)}
                          onCheckedChange={(checked) => {
                            setRequiredIndicators(prev =>
                              checked ? [...prev, ind.key] : prev.filter(k => k !== ind.key)
                            );
                          }}
                          className="mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <span className="text-sm font-medium">{ind.label}</span>
                          <p className="text-xs text-muted-foreground">{ind.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">RSIフィルター範囲</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[rsiMin, rsiMax]}
                      onValueChange={([min, max]) => { setRsiMin(min); setRsiMax(max); }}
                      min={0}
                      max={100}
                      step={5}
                      className="flex-1"
                      data-testid="slider-rsi-range"
                    />
                    <Badge variant="secondary" className="min-w-[70px] justify-center" data-testid="text-rsi-range">
                      {rsiMin}-{rsiMax}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">RSI値がこの範囲内の場合のみエントリー</p>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">シミュレーション日数</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[simDays]}
                      onValueChange={([v]) => setSimDays(v)}
                      min={timeframe !== "1d" ? 10 : 80}
                      max={timeframe !== "1d" ? 60 : 400}
                      step={timeframe !== "1d" ? 5 : 10}
                      className="flex-1"
                      data-testid="slider-sim-days"
                    />
                    <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-sim-days">
                      {simDays}日
                    </Badge>
                  </div>
                  {timeframe !== "1d" && (
                    <p className="text-xs text-muted-foreground">日中足データは最大60日分取得可能です（DB蓄積データ優先使用）</p>
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Banknote className="h-4 w-4 text-emerald-600" />
                    初期資金
                  </Label>
                  <div className="flex items-center gap-3">
                    {market === "US" ? (
                      <>
                        <Slider
                          value={[initialCapital]}
                          onValueChange={([v]) => setInitialCapital(v)}
                          min={1000}
                          max={100000}
                          step={1000}
                          className="flex-1"
                          data-testid="slider-initial-capital"
                        />
                        <Badge variant="secondary" className="min-w-[70px] justify-center" data-testid="text-initial-capital">
                          ${initialCapital.toLocaleString("en-US")}
                        </Badge>
                      </>
                    ) : (
                      <>
                        <Slider
                          value={[initialCapital / 10000]}
                          onValueChange={([v]) => setInitialCapital(v * 10000)}
                          min={10}
                          max={1000}
                          step={10}
                          className="flex-1"
                          data-testid="slider-initial-capital"
                        />
                        <Badge variant="secondary" className="min-w-[70px] justify-center" data-testid="text-initial-capital">
                          {(initialCapital / 10000).toFixed(0)}万円
                        </Badge>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">手元資金。資金不足の場合は買いシグナルがあってもスキップされます</p>
                </div>

              </div>

              <div className="pt-4 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-muted-foreground mb-3"
                  data-testid="button-toggle-advanced"
                >
                  <Settings2 className="h-3 w-3 mr-1" />
                  {showAdvanced ? "高度なフィルターを非表示" : "高度なフィルターを表示"}
                </Button>

                {showAdvanced && (
                  <div className="grid gap-4 sm:grid-cols-2 animate-in slide-in-from-top-2">
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">損切り (Stop Loss %)</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[stopLossPercent]}
                          onValueChange={([v]) => setStopLossPercent(v)}
                          min={0}
                          max={10}
                          step={0.5}
                          className="flex-1"
                          data-testid="slider-stop-loss"
                        />
                        <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-stop-loss">
                          {stopLossPercent === 0 ? "なし" : `${stopLossPercent}%`}
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">最大保持日数</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[maxHoldDays]}
                          onValueChange={([v]) => setMaxHoldDays(v)}
                          min={1}
                          max={10}
                          step={1}
                          className="flex-1"
                          data-testid="slider-max-hold-days"
                        />
                        <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-max-hold-days">
                          {maxHoldDays}日
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">最低出来高（単元数）</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[minVolume / 100]}
                          onValueChange={([v]) => setMinVolume(v * 100)}
                          min={0}
                          max={100}
                          step={1}
                          className="flex-1"
                          data-testid="slider-min-volume"
                        />
                        <Badge variant="secondary" className="min-w-[80px] justify-center" data-testid="text-min-volume">
                          {minVolume === 0 ? "なし" : `${minVolume.toLocaleString()}単元`}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">日足の出来高が少ない銘柄を除外（推奨: 1,000単元以上）</p>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">最低ボラティリティ（%）</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[minVolatility * 10]}
                          onValueChange={([v]) => setMinVolatility(v / 10)}
                          min={0}
                          max={30}
                          step={1}
                          className="flex-1"
                          data-testid="slider-min-volatility"
                        />
                        <Badge variant="secondary" className="min-w-[70px] justify-center" data-testid="text-min-volatility">
                          {minVolatility === 0 ? "なし" : `${minVolatility.toFixed(1)}%`}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">直近20本の価格変動率が低い銘柄を除外（推奨: 0.5%以上）</p>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">取引時間帯（日中足のみ）</Label>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 space-y-1">
                          <span className="text-xs text-muted-foreground">開始</span>
                          <select
                            value={tradingStartHour}
                            onChange={(e) => setTradingStartHour(Number(e.target.value))}
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            data-testid="select-trading-start-hour"
                          >
                            {[9, 10, 11, 12, 13, 14].map(h => (
                              <option key={h} value={h}>{h}:00</option>
                            ))}
                          </select>
                        </div>
                        <span className="text-muted-foreground pt-4">〜</span>
                        <div className="flex-1 space-y-1">
                          <span className="text-xs text-muted-foreground">終了（この時間未満）</span>
                          <select
                            value={tradingEndHour}
                            onChange={(e) => setTradingEndHour(Number(e.target.value))}
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            data-testid="select-trading-end-hour"
                          >
                            {[10, 11, 12, 13, 14, 15, 16].map(h => (
                              <option key={h} value={h}>{h}:00</option>
                            ))}
                          </select>
                        </div>
                        <Badge variant="secondary" className="min-w-[80px] justify-center mt-4" data-testid="text-trading-hours">
                          {tradingStartHour}:00〜{tradingEndHour}:00
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">エントリーする時間帯を制限（9時台のみが最も勝率が高い）</p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">株価除外帯</Label>
                        <Switch
                          checked={excludePriceEnabled}
                          onCheckedChange={setExcludePriceEnabled}
                          data-testid="switch-exclude-price"
                        />
                      </div>
                      {excludePriceEnabled && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 space-y-1">
                              <span className="text-xs text-muted-foreground">下限（円）</span>
                              <input
                                type="number"
                                value={excludePriceMin}
                                onChange={(e) => setExcludePriceMin(Math.max(0, Number(e.target.value)))}
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                                data-testid="input-exclude-price-min"
                              />
                            </div>
                            <span className="mt-5 text-sm text-muted-foreground">〜</span>
                            <div className="flex-1 space-y-1">
                              <span className="text-xs text-muted-foreground">上限（円）</span>
                              <input
                                type="number"
                                value={excludePriceMax}
                                onChange={(e) => setExcludePriceMax(Math.max(0, Number(e.target.value)))}
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                                data-testid="input-exclude-price-max"
                              />
                            </div>
                          </div>
                          <Badge variant="secondary" className="w-full justify-center" data-testid="text-exclude-price-range">
                            {excludePriceMin.toLocaleString()}円〜{excludePriceMax.toLocaleString()}円の銘柄を除外
                          </Badge>
                          <p className="text-xs text-muted-foreground">指定した株価帯の銘柄をバックテスト対象から除外します</p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">弱コンボ除外</Label>
                      <p className="text-xs text-muted-foreground">勝率の低い指標コンボ（RSI/MA/BB）をエントリー対象から除外します</p>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-exclude-nbn">
                          <input type="checkbox" checked={excludeComboNBN} onChange={(e) => setExcludeComboNBN(e.target.checked)} className="rounded border-input" />
                          <span className="text-sm">neutral/buy/neutral</span>
                          <Badge variant="destructive" className="text-xs ml-auto">勝率11%</Badge>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-exclude-nnn">
                          <input type="checkbox" checked={excludeComboNNN} onChange={(e) => setExcludeComboNNN(e.target.checked)} className="rounded border-input" />
                          <span className="text-sm">neutral/neutral/neutral</span>
                          <Badge variant="secondary" className="text-xs ml-auto">勝率57%</Badge>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-exclude-nsn">
                          <input type="checkbox" checked={excludeComboNSN} onChange={(e) => setExcludeComboNSN(e.target.checked)} className="rounded border-input" />
                          <span className="text-sm">neutral/sell/neutral</span>
                          <Badge variant="destructive" className="text-xs ml-auto">勝率0%</Badge>
                        </label>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">最小シグナルスコア</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[minSignalScore]}
                          onValueChange={([v]) => setMinSignalScore(v)}
                          min={0}
                          max={100}
                          step={5}
                          className="flex-1"
                          data-testid="slider-min-signal-score"
                        />
                        <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-min-signal-score">
                          {minSignalScore}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">MACD/RSI/MA/BB等の複合スコア（0〜110）</p>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">シグナル確認日数</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[confirmDays]}
                          onValueChange={([v]) => setConfirmDays(v)}
                          min={1}
                          max={5}
                          step={1}
                          className="flex-1"
                          data-testid="slider-confirm-days"
                        />
                        <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-confirm-days">
                          {confirmDays}日
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">連続で買いシグナルが出た日数で確認</p>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">最大ギャップ %</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[maxGapPercent]}
                          onValueChange={([v]) => setMaxGapPercent(v)}
                          min={0.5}
                          max={10}
                          step={0.5}
                          className="flex-1"
                          data-testid="slider-max-gap"
                        />
                        <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-max-gap">
                          {maxGapPercent}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">翌日始値の乖離がこれ以上ならスキップ</p>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">出来高急増倍率</Label>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[volumeSurgeRatio]}
                          onValueChange={([v]) => setVolumeSurgeRatio(v)}
                          min={1.0}
                          max={5.0}
                          step={0.1}
                          className="flex-1"
                          data-testid="slider-volume-surge"
                        />
                        <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-volume-surge">
                          {volumeSurgeRatio.toFixed(1)}x
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch
                        checked={requireMacdCrossover}
                        onCheckedChange={setRequireMacdCrossover}
                        data-testid="switch-macd-crossover"
                      />
                      <div>
                        <Label className="text-sm font-medium">MACDクロス必須</Label>
                        <p className="text-xs text-muted-foreground">MACDがシグナル線を上抜けした日のみ</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch
                        checked={requireRsiReversal}
                        onCheckedChange={setRequireRsiReversal}
                        data-testid="switch-rsi-reversal"
                      />
                      <div>
                        <Label className="text-sm font-medium">RSI反転必須</Label>
                        <p className="text-xs text-muted-foreground">RSIが30以下から反転上昇した日のみ</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch
                        checked={requireVolumeSurge}
                        onCheckedChange={setRequireVolumeSurge}
                        data-testid="switch-volume-surge"
                      />
                      <div>
                        <Label className="text-sm font-medium">出来高急増必須</Label>
                        <p className="text-xs text-muted-foreground">20日平均の{volumeSurgeRatio.toFixed(1)}倍以上</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch
                        checked={requireUptrend}
                        onCheckedChange={setRequireUptrend}
                        data-testid="switch-require-uptrend"
                      />
                      <div>
                        <Label className="text-sm font-medium">上昇トレンド必須</Label>
                        <p className="text-xs text-muted-foreground">MA25 &gt; MA75 かつ価格 &gt; MA25</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch
                        checked={dynamicTarget}
                        onCheckedChange={setDynamicTarget}
                        data-testid="switch-dynamic-target"
                      />
                      <div>
                        <Label className="text-sm font-medium">動的利確</Label>
                        <p className="text-xs text-muted-foreground">ボラティリティに応じて利確目標を自動調整</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch
                        checked={trailingStop}
                        onCheckedChange={setTrailingStop}
                        data-testid="switch-trailing-stop"
                      />
                      <div>
                        <Label className="text-sm font-medium">トレーリングストップ</Label>
                        <p className="text-xs text-muted-foreground">高値から{trailingStopPercent}%下落で利確</p>
                      </div>
                    </div>

                    {trailingStop && (
                      <div className="space-y-3">
                        <Label className="text-sm font-medium">トレーリング幅 %</Label>
                        <div className="flex items-center gap-3">
                          <Slider
                            value={[trailingStopPercent]}
                            onValueChange={([v]) => setTrailingStopPercent(v)}
                            min={0.3}
                            max={5.0}
                            step={0.1}
                            className="flex-1"
                            data-testid="slider-trailing-stop"
                          />
                          <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-trailing-stop">
                            {trailingStopPercent.toFixed(1)}%
                          </Badge>
                        </div>
                      </div>
                    )}

                    {isIntraday && (
                      <>
                        <div className="sm:col-span-2 pt-3 border-t">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={requireDailyConfirm}
                              onCheckedChange={setRequireDailyConfirm}
                              data-testid="switch-daily-confirm"
                            />
                            <div>
                              <Label className="text-sm font-medium flex items-center gap-1">
                                <Activity className="h-3 w-3 text-indigo-500" />
                                日足確認フィルター
                              </Label>
                              <p className="text-xs text-muted-foreground">日足の指標も買いシグナルの日のみ日中足でエントリー</p>
                            </div>
                          </div>
                        </div>

                        {requireDailyConfirm && (
                          <>
                            <div className="space-y-3">
                              <Label className="text-sm font-medium">日足 最小買い指標数</Label>
                              <div className="flex items-center gap-3">
                                <Slider
                                  value={[dailyMinBuyIndicators]}
                                  onValueChange={([v]) => setDailyMinBuyIndicators(v)}
                                  min={1}
                                  max={4}
                                  step={1}
                                  className="flex-1"
                                  data-testid="slider-daily-min-buy"
                                />
                                <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-daily-min-buy">
                                  {dailyMinBuyIndicators}/4
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">日足MACD/RSI/MA/BBのうち何個以上が「買い」</p>
                            </div>

                            <div className="space-y-3">
                              <Label className="text-sm font-medium">日足 最小シグナルスコア</Label>
                              <div className="flex items-center gap-3">
                                <Slider
                                  value={[dailyMinSignalScore]}
                                  onValueChange={([v]) => setDailyMinSignalScore(v)}
                                  min={0}
                                  max={100}
                                  step={5}
                                  className="flex-1"
                                  data-testid="slider-daily-min-score"
                                />
                                <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-daily-min-score">
                                  {dailyMinSignalScore}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">日足の複合シグナルスコア下限</p>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t flex items-center gap-3 flex-wrap">
                <Button
                  onClick={() => { setActiveTab("results"); runMutation.mutate(); }}
                  disabled={isRunning || runMutation.isPending}
                  data-testid="button-run-backtest"
                >
                  {runMutation.isPending || isRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PlayCircle className="h-4 w-4 mr-2" />
                  )}
                  {isRunning ? "実行中..." : "バックテスト実行"}
                  {(useAi || useQuantum) && !isRunning && (
                    <span className="ml-1 text-xs opacity-80">
                      [{useAi ? "AI" : ""}{useAi && useQuantum ? "+" : ""}{useQuantum ? "量子" : ""}]
                    </span>
                  )}
                </Button>
                <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
                  <Badge variant={timeframe !== "1d" ? "default" : "outline"}>{({"5m":"5分足","10m":"10分足","30m":"30分足","1d":"日足"} as Record<string,string>)[timeframe] || timeframe}</Badge>
                  <Badge variant="outline">目標 {targetPercent.toFixed(1)}%</Badge>
                  {requiredIndicators.length > 0
                    ? <Badge variant="outline">必須: {requiredIndicators.map(i => i.toUpperCase()).join("/")}</Badge>
                    : <Badge variant="outline">指標制限なし</Badge>}
                  <Badge variant="outline">RSI {rsiMin}-{rsiMax}</Badge>
                  <Badge variant="outline">{simDays}日間</Badge>
                  {useAi && <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300">AI</Badge>}
                  {useQuantum && <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">量子</Badge>}
                  {requireMacdCrossover && <Badge variant="outline" className="border-green-300 text-green-700 dark:text-green-400">MACDクロス</Badge>}
                  {requireRsiReversal && <Badge variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-400">RSI反転</Badge>}
                  {requireVolumeSurge && <Badge variant="outline" className="border-orange-300 text-orange-700 dark:text-orange-400">出来高急増</Badge>}
                  {minSignalScore > 0 && <Badge variant="outline">スコア{minSignalScore}+</Badge>}
                  {confirmDays > 1 && <Badge variant="outline">{confirmDays}日確認</Badge>}
                  {stopLossPercent > 0 && <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-400">SL {stopLossPercent}%</Badge>}
                  {trailingStop && <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">TS {trailingStopPercent}%</Badge>}
                  {maxHoldDays > 1 && <Badge variant="outline">{maxHoldDays}日保持</Badge>}
                  {minVolume > 0 && <Badge variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-400">出来高≥{minVolume.toLocaleString()}単元</Badge>}
                  {minVolatility > 0 && <Badge variant="outline" className="border-purple-300 text-purple-700 dark:text-purple-400">Vol≥{minVolatility.toFixed(1)}%</Badge>}
                  {excludePriceEnabled && <Badge variant="outline" className="border-orange-300 text-orange-700 dark:text-orange-400">除外{excludePriceMin.toLocaleString()}〜{excludePriceMax.toLocaleString()}円</Badge>}
                  {excludeComboNBN && <Badge variant="outline" className="border-rose-300 text-rose-700 dark:text-rose-400">N/B/N除外</Badge>}
                  {excludeComboNNN && <Badge variant="outline" className="border-rose-300 text-rose-700 dark:text-rose-400">N/N/N除外</Badge>}
                  {excludeComboNSN && <Badge variant="outline" className="border-rose-300 text-rose-700 dark:text-rose-400">N/S/N除外</Badge>}
                  {dynamicTarget && <Badge variant="outline">動的利確</Badge>}
                  {requireDailyConfirm && <Badge variant="outline" className="border-indigo-300 text-indigo-700 dark:text-indigo-400">日足確認</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">プリセット条件</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-medium">日足プリセット</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("1d"); setTargetPercent(1.0); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(200); setUseAi(false); setUseQuantum(false); setStopLossPercent(0); setMaxHoldDays(1); setRequireUptrend(false); setDynamicTarget(false); setRequireMacdCrossover(false); setRequireRsiReversal(false); setRequireVolumeSurge(false); setVolumeSurgeRatio(1.5); setMaxGapPercent(2.0); setTrailingStop(false); setTrailingStopPercent(1.5); setConfirmDays(1); setMinSignalScore(0); setShowAdvanced(false); }}
                    data-testid="button-preset-default"
                  >
                    デフォルト（ルールベース）
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-300 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    onClick={() => { setTimeframe("1d"); setTargetPercent(0.8); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(200); setUseAi(false); setUseQuantum(false); setStopLossPercent(1.0); setMaxHoldDays(3); setRequireUptrend(false); setDynamicTarget(true); setRequireMacdCrossover(false); setRequireRsiReversal(false); setRequireVolumeSurge(false); setVolumeSurgeRatio(1.5); setMaxGapPercent(1.5); setTrailingStop(true); setTrailingStopPercent(1.5); setConfirmDays(1); setMinSignalScore(20); setShowAdvanced(true); }}
                    data-testid="button-preset-high-winrate"
                  >
                    <Trophy className="h-3 w-3 mr-1 text-amber-500" />
                    高勝率（厳選）
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("1d"); setTargetPercent(1.0); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(200); setUseAi(true); setUseQuantum(true); setAiThreshold(0.5); setStopLossPercent(0); setMaxHoldDays(1); setRequireUptrend(false); setDynamicTarget(false); setRequireMacdCrossover(false); setRequireRsiReversal(false); setRequireVolumeSurge(false); setVolumeSurgeRatio(1.5); setMaxGapPercent(2.0); setTrailingStop(false); setTrailingStopPercent(1.5); setConfirmDays(1); setMinSignalScore(0); setShowAdvanced(false); }}
                    data-testid="button-preset-ai-quantum"
                  >
                    <Brain className="h-3 w-3 mr-1 text-sky-500" />
                    <Atom className="h-3 w-3 mr-1 text-purple-500" />
                    AI+量子 適材適所
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("1d"); setTargetPercent(0.5); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(200); setUseAi(true); setUseQuantum(false); setAiThreshold(0.6); setStopLossPercent(0); setMaxHoldDays(1); setRequireUptrend(false); setDynamicTarget(false); setRequireMacdCrossover(false); setRequireRsiReversal(false); setRequireVolumeSurge(false); setShowAdvanced(false); }}
                    data-testid="button-preset-ai-only"
                  >
                    <Brain className="h-3 w-3 mr-1 text-sky-500" />
                    AIスコアリングのみ
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("1d"); setTargetPercent(1.0); setMinBuyIndicators(4); setRsiMin(15); setRsiMax(30); setRequireMaBuy(false); setSimDays(200); setUseAi(false); setUseQuantum(false); setStopLossPercent(1.0); setMaxHoldDays(3); setRequireUptrend(false); setDynamicTarget(true); setRequireMacdCrossover(false); setRequireRsiReversal(false); setRequireVolumeSurge(false); setMaxGapPercent(1.5); setTrailingStop(true); setTrailingStopPercent(1.5); setConfirmDays(1); setMinSignalScore(30); setShowAdvanced(true); }}
                    data-testid="button-preset-strict"
                  >
                    厳格フィルター
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("1d"); setTargetPercent(0.7); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(true); setSimDays(200); setUseAi(false); setUseQuantum(false); }}
                    data-testid="button-preset-trend-follow"
                  >
                    トレンドフォロー
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("1d"); setTargetPercent(2.0); setMinBuyIndicators(4); setRsiMin(0); setRsiMax(25); setRequireMaBuy(true); setSimDays(200); setUseAi(true); setUseQuantum(true); setAiThreshold(0.6); }}
                    data-testid="button-preset-aggressive-ai"
                  >
                    <Brain className="h-3 w-3 mr-1 text-sky-500" />
                    積極的+AI厳選
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground font-medium mt-4">5分足プリセット</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("5m"); setTargetPercent(0.3); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(60); setUseAi(false); setUseQuantum(false); }}
                    data-testid="button-preset-5m-default"
                  >
                    5分足デフォルト
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("5m"); setTargetPercent(0.5); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(60); setUseAi(true); setUseQuantum(true); setAiThreshold(0.5); }}
                    data-testid="button-preset-5m-ai-quantum"
                  >
                    <Brain className="h-3 w-3 mr-1 text-sky-500" />
                    5分足 AI+量子
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setTimeframe("5m"); setTargetPercent(0.3); setMinBuyIndicators(3); setRsiMin(20); setRsiMax(30); setRequireMaBuy(true); setSimDays(60); setUseAi(false); setUseQuantum(false); setRequireDailyConfirm(false); }}
                    data-testid="button-preset-5m-strict"
                  >
                    5分足 厳格
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-indigo-300 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                    onClick={() => { setTimeframe("5m"); setTargetPercent(0.3); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(60); setUseAi(false); setUseQuantum(false); setRequireDailyConfirm(true); setDailyMinBuyIndicators(2); setDailyMinSignalScore(15); setStopLossPercent(1.0); setDynamicTarget(true); setRequireMacdCrossover(false); setRequireRsiReversal(false); setMinSignalScore(15); setTrailingStop(true); setTrailingStopPercent(1.5); setMaxHoldDays(3); setShowAdvanced(true); }}
                    data-testid="button-preset-5m-daily"
                  >
                    <Activity className="h-3 w-3 mr-1 text-indigo-500" />
                    5分足+日足確認
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compare" className="space-y-4 mt-4">
          {comparisonData && comparisonData.length >= 2 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <GitCompare className="h-5 w-5" />パターン比較
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">実行日時</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">時間足</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">目標%</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">AI/量子</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">シグナル数</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">勝ち</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">負け</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">勝率</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonData.map((run, idx) => {
                        const best = comparisonData.reduce((a, b) => a.winRate > b.winRate ? a : b);
                        const isBest = run.runId === best.runId;
                        const cfg = run.config;
                        return (
                          <tr
                            key={run.runId}
                            className={`border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors ${isBest ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}
                            onClick={() => { setSelectedRun(run.runId); setActiveTab("results"); }}
                            data-testid={`compare-row-${idx}`}
                          >
                            <td className="py-2.5 px-2">
                              <div className="flex items-center gap-1.5">
                                {isBest && <Trophy className="h-3.5 w-3.5 text-amber-500" />}
                                <span className="text-xs">
                                  {run.createdAt
                                    ? new Date(run.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
                                    : "-"}
                                </span>
                              </div>
                            </td>
                            <td className="text-center py-2.5 px-2">
                              <Badge variant={cfg?.timeframe !== "1d" ? "default" : "outline"} className="text-xs">
                                {({"5m":"5分足","10m":"10分足","30m":"30分足","1d":"日足"} as Record<string,string>)[cfg?.timeframe || "1d"]}
                              </Badge>
                            </td>
                            <td className="text-center py-2.5 px-2">
                              <Badge variant="outline" className="text-xs">{cfg?.targetPercent ?? "?"}%</Badge>
                            </td>
                            <td className="text-center py-2.5 px-2">
                              <div className="flex items-center justify-center gap-1">
                                {cfg?.useAi && <Badge className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300">AI</Badge>}
                                {cfg?.useQuantum && <Badge className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">量子</Badge>}
                                {!cfg?.useAi && !cfg?.useQuantum && <Badge variant="secondary" className="text-[10px]">ルール</Badge>}
                              </div>
                            </td>
                            <td className="text-center py-2.5 px-2 font-medium">{run.count}</td>
                            <td className="text-center py-2.5 px-2 text-emerald-600 dark:text-emerald-400 font-medium">{run.wins}</td>
                            <td className="text-center py-2.5 px-2 text-red-500 dark:text-red-400 font-medium">{run.losses}</td>
                            <td className="text-center py-2.5 px-2">
                              <Badge
                                variant={run.winRate >= 50 ? "default" : "destructive"}
                                className="text-xs"
                                data-testid={`text-compare-winrate-${idx}`}
                              >
                                {run.winRate}%
                              </Badge>
                            </td>
                            <td className="text-center py-2.5 px-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(run.runId); }}
                                data-testid={`button-delete-compare-${idx}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <GitCompare className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                <h3 className="font-semibold mb-1">比較するには2つ以上の実行結果が必要です</h3>
                <p className="text-muted-foreground text-sm">条件設定タブから異なる条件でバックテストを実行してください</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="results" className="space-y-4 mt-4">
          {activeRunConfig && (
            <Card>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-muted-foreground">実行条件:</span>
                  <Badge variant={activeRunConfig.timeframe !== "1d" ? "default" : "outline"}>
                    {({"5m":"5分足","10m":"10分足","30m":"30分足","1d":"日足"} as Record<string,string>)[activeRunConfig.timeframe]}
                  </Badge>
                  <Badge variant="outline">目標 {activeRunConfig.targetPercent}%</Badge>
                  {activeRunConfig.requiredIndicators?.length
                    ? <Badge variant="outline">必須: {(activeRunConfig.requiredIndicators as string[]).map((i: string) => i.toUpperCase()).join("/")}</Badge>
                    : <Badge variant="outline">指標 {activeRunConfig.minBuyIndicators}+</Badge>}
                  <Badge variant="outline">RSI {activeRunConfig.rsiMin}-{activeRunConfig.rsiMax}</Badge>
                  <Badge variant="outline">{activeRunConfig.simDays}日間</Badge>
                  {activeRunConfig.useAi && <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300">AI (閾値{((activeRunConfig.aiThreshold ?? 0.5) * 100).toFixed(0)}%)</Badge>}
                  {activeRunConfig.useQuantum && <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">量子QAOA</Badge>}
                </div>
              </CardContent>
            </Card>
          )}

          {aiQuantumSummary && (
            <Card data-testid="card-ai-quantum-summary" className="border-sky-200 dark:border-sky-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4 text-sky-500" />
                  <Atom className="h-4 w-4 text-purple-500" />
                  AI/量子 分析サマリー
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  {aiQuantumSummary.ai && !aiQuantumSummary.ai.skipped && (
                    <div className="bg-sky-50 dark:bg-sky-950/30 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Brain className="h-3.5 w-3.5 text-sky-500" />
                        <span className="text-xs font-medium">AIスコアリング</span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">モデル精度</span>
                          <span className="font-medium">{aiQuantumSummary.ai.test_accuracy}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">通過</span>
                          <span className="font-medium text-emerald-600">{aiQuantumSummary.ai.passed}件</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">除外</span>
                          <span className="font-medium text-red-500">{aiQuantumSummary.ai.filtered}件</span>
                        </div>
                        {aiQuantumSummary.ai.feature_importance && (
                          <div className="pt-2 border-t mt-2">
                            <p className="text-[10px] text-muted-foreground mb-1">特徴量重要度</p>
                            {Object.entries(aiQuantumSummary.ai.feature_importance as Record<string, number>)
                              .sort(([, a], [, b]) => (b as number) - (a as number))
                              .slice(0, 4)
                              .map(([key, val]) => (
                                <div key={key} className="flex items-center gap-1.5 mb-0.5">
                                  <div className="flex-1 bg-sky-200 dark:bg-sky-800 rounded-full h-1.5 overflow-hidden">
                                    <div className="bg-sky-500 h-full rounded-full" style={{ width: `${(val as number) * 100}%` }} />
                                  </div>
                                  <span className="text-[10px] w-16 text-right">{key}</span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {aiQuantumSummary.quantum && !aiQuantumSummary.quantum.skipped && (
                    <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Atom className="h-3.5 w-3.5 text-purple-500" />
                        <span className="text-xs font-medium">量子最適化</span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">手法</span>
                          <span className="font-medium">QAOA</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">最適化日数</span>
                          <span className="font-medium">{aiQuantumSummary.quantum.days_optimized}日</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">選択数</span>
                          <span className="font-medium text-purple-600">{aiQuantumSummary.quantum.selected}件</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">処理時間</span>
                          <span className="font-medium">{aiQuantumSummary.quantum.time_ms}ms</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {aiQuantumSummary.var && !aiQuantumSummary.var.skipped && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Shield className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs font-medium">量子VaR推定</span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">VaR (95%)</span>
                          <span className="font-medium">{aiQuantumSummary.var.var_95_pct}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">平均リターン</span>
                          <span className="font-medium">{aiQuantumSummary.var.mean_return_pct}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">標準偏差</span>
                          <span className="font-medium">{aiQuantumSummary.var.std_pct}%</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {stats && (<>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
              <Card data-testid="card-win-count">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="text-xs text-muted-foreground">勝ち</p>
                      <p className="text-2xl font-bold" data-testid="text-win-count">{stats.wins}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-loss-count">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-5 w-5 text-red-500 dark:text-red-400" />
                    <div>
                      <p className="text-xs text-muted-foreground">負け</p>
                      <p className="text-2xl font-bold" data-testid="text-loss-count">{stats.losses}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-win-rate">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">勝率</p>
                      <p className="text-2xl font-bold" data-testid="text-win-rate">{stats.winRate}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-avg-pl">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2">
                    {stats.avgPL >= 0
                      ? <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      : <XCircle className="h-5 w-5 text-red-500 dark:text-red-400" />}
                    <div>
                      <p className="text-xs text-muted-foreground">平均損益</p>
                      <p className={`text-2xl font-bold ${stats.avgPL >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`} data-testid="text-avg-pl">
                        {stats.avgPL >= 0 ? "+" : ""}{stats.avgPL}%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-profit-factor">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-amber-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">PF</p>
                      <p className={`text-2xl font-bold ${stats.profitFactor >= 1 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`} data-testid="text-profit-factor">
                        {stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {stats.hasCapitalTracking && stats.capitalStart != null && (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <Card data-testid="card-capital-start">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2">
                      <Banknote className="h-5 w-5 text-blue-500" />
                      <div>
                        <p className="text-xs text-muted-foreground">初期資金</p>
                        <p className="text-lg font-bold tabular-nums" data-testid="text-capital-start">
                          {stats.isUS ? `$${stats.capitalStart.toLocaleString("en-US")}` : `${(stats.capitalStart / 10000).toFixed(0)}万円`}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card data-testid="card-capital-end">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2">
                      <Banknote className={`h-5 w-5 ${(stats.capitalEnd ?? 0) >= stats.capitalStart ? "text-emerald-500" : "text-red-500"}`} />
                      <div>
                        <p className="text-xs text-muted-foreground">最終資金</p>
                        <p className={`text-lg font-bold tabular-nums ${(stats.capitalEnd ?? 0) >= stats.capitalStart ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`} data-testid="text-capital-end">
                          {stats.capitalEnd != null ? (stats.isUS ? `$${stats.capitalEnd.toLocaleString("en-US")}` : `${(stats.capitalEnd / 10000).toFixed(1)}万円`) : "-"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card data-testid="card-capital-profit">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2">
                      {stats.totalProfitYen >= 0
                        ? <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        : <TrendingDown className="h-5 w-5 text-red-500" />}
                      <div>
                        <p className="text-xs text-muted-foreground">総損益{stats.isUS ? "（$）" : "（円）"}</p>
                        <p className={`text-lg font-bold tabular-nums ${stats.totalProfitYen >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`} data-testid="text-capital-profit">
                          {stats.totalProfitYen >= 0 ? "+" : ""}{stats.isUS ? `$${Math.abs(stats.totalProfitYen).toLocaleString("en-US")}` : `${stats.totalProfitYen.toLocaleString("ja-JP")}円`}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card data-testid="card-capital-return">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2">
                      <BarChart3 className={`h-5 w-5 ${(stats.capitalReturn ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`} />
                      <div>
                        <p className="text-xs text-muted-foreground">資金収益率</p>
                        <p className={`text-lg font-bold tabular-nums ${(stats.capitalReturn ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`} data-testid="text-capital-return">
                          {stats.capitalReturn != null ? `${stats.capitalReturn >= 0 ? "+" : ""}${stats.capitalReturn}%` : "-"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {capitalChartData && (
              <Card data-testid="card-capital-chart">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    資産推移
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-3">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={capitalChartData.points} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="capitalGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickFormatter={(v: string) => v.slice(5)}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickFormatter={(v: number) => stats?.isUS ? `$${v.toLocaleString("en-US")}` : `${(v / 10000).toFixed(0)}万`}
                        domain={["dataMin - 50000", "dataMax + 50000"]}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        formatter={(value: number) => [stats?.isUS ? `$${value.toLocaleString("en-US")}` : `${value.toLocaleString("ja-JP")}円`, "資産"]}
                        labelFormatter={(label: string) => label}
                      />
                      <ReferenceLine
                        y={capitalChartData.initialCap}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="4 4"
                        strokeOpacity={0.5}
                      />
                      <Area
                        type="monotone"
                        dataKey="capital"
                        stroke="hsl(var(--primary))"
                        fill="url(#capitalGrad)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </>)}

          <div className="flex items-center gap-3 flex-wrap">
            {runs && runs.length > 0 && (
              <Select value={selectedRun} onValueChange={setSelectedRun}>
                <SelectTrigger className="w-[340px]" data-testid="select-backtest-run">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">最新の結果</SelectItem>
                  {runs.map(run => (
                    <SelectItem key={run.runId} value={run.runId}>
                      <RunLabel run={run} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {activeRunId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteMutation.mutate(activeRunId)}
                disabled={deleteMutation.isPending}
                data-testid="button-delete-run"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                削除
              </Button>
            )}
            {results && (
              <Badge variant="outline" data-testid="badge-result-count">{results.length}件</Badge>
            )}
          </div>

          {runsLoading || resultsLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : !runs || runs.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <PlayCircle className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                <h3 className="font-semibold mb-1">バックテスト結果がありません</h3>
                <p className="text-muted-foreground text-sm">
                  「条件設定」タブで条件を選択し、バックテストを実行してください
                </p>
              </CardContent>
            </Card>
          ) : !results || results.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                <h3 className="font-semibold mb-1">この実行では条件に合うシグナルが検出されませんでした</h3>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-end mb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortOrder(prev => prev === "desc" ? "asc" : "desc")}
                  className="gap-1.5 text-xs"
                  data-testid="button-sort-order"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  取引日時: {sortOrder === "desc" ? "新しい順" : "古い順"}
                </Button>
              </div>
              {[...results].sort((a, b) =>
                sortOrder === "desc"
                  ? b.buyDate.localeCompare(a.buyDate)
                  : a.buyDate.localeCompare(b.buyDate)
              ).map((r) => (
                <Link key={r.id} href={`/stocks/${r.ticker}`}>
                  <Card className="cursor-pointer" data-testid={`backtest-row-${r.id}`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0">
                          {r.isWin
                            ? <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            : <XCircle className="h-5 w-5 text-red-500 dark:text-red-400 shrink-0" />}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm" data-testid={`text-ticker-${r.ticker}`}>{r.ticker}</span>
                              <Badge variant={r.isWin ? "default" : "destructive"} className="text-xs">
                                {r.isWin ? "勝ち" : "負け"}
                              </Badge>
                              {r.aiScore != null && (
                                <Badge className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300" data-testid={`badge-ai-score-${r.id}`}>
                                  <Brain className="h-2.5 w-2.5 mr-0.5" />
                                  AI {(r.aiScore * 100).toFixed(0)}%
                                </Badge>
                              )}
                              {r.quantumSelected != null && (
                                <Badge className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" data-testid={`badge-quantum-${r.id}`}>
                                  <Atom className="h-2.5 w-2.5 mr-0.5" />
                                  {r.quantumMethod?.includes("QAOA") ? "QAOA" : "量子"}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                              <span>シグナル: {r.signalDate}</span>
                              <span>→</span>
                              <span>購入: {r.buyDate}</span>
                              <span>始値 {stats?.isUS ? `$${r.buyPrice.toLocaleString("en-US")}` : `${r.buyPrice.toLocaleString("ja-JP")}円`}</span>
                              <span>|</span>
                              <span>高値 {stats?.isUS ? `$${r.dayHigh.toLocaleString("en-US")}` : `${r.dayHigh.toLocaleString("ja-JP")}円`}</span>
                              {r.varEstimate != null && (
                                <>
                                  <span>|</span>
                                  <span className="text-amber-600">VaR: {r.varEstimate.toFixed(2)}%</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(() => {
                              const ri = activeRunConfig?.requiredIndicators as string[] | undefined;
                              const hasRI = ri && ri.length > 0;
                              return (
                                <>
                                  <TrendBadge trend={r.macdTrend} label="MACD" active={!hasRI || ri!.includes("macd")} />
                                  <TrendBadge trend={r.rsiTrend} label={`RSI${r.rsiValue != null ? ` ${r.rsiValue.toFixed(0)}` : ""}`} active={!hasRI || ri!.includes("rsi")} />
                                  <TrendBadge trend={r.maTrend} label="MA" active={!hasRI || ri!.includes("ma")} />
                                  <TrendBadge trend={r.bbTrend} label="BB" active={!hasRI || ri!.includes("bb")} />
                                </>
                              );
                            })()}
                          </div>
                          <div className={`text-right min-w-[80px] ${r.profitLossPercent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                            <p className="font-bold text-sm" data-testid={`text-pl-${r.id}`}>
                              {r.profitLossPercent >= 0 ? "+" : ""}{r.profitLossPercent.toFixed(2)}%
                            </p>
                            <p className="text-xs">
                              {r.profitLoss >= 0 ? "+" : ""}{stats?.isUS ? `$${Math.abs(r.profitLoss).toLocaleString("en-US")}` : `${r.profitLoss.toLocaleString("ja-JP")}円`}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
