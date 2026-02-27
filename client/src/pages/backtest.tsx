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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PlayCircle, Trophy, TrendingDown, BarChart3, Trash2, Loader2,
  CheckCircle, XCircle, Settings2, GitCompare, List,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
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
}

interface BacktestParams {
  targetPercent: number;
  minBuyIndicators: number;
  rsiMin: number;
  rsiMax: number;
  requireMaBuy: boolean;
  simDays: number;
  label: string;
}

function TrendBadge({ trend, label }: { trend: string | null; label: string }) {
  const variant = trend === "buy" ? "default" : trend === "sell" ? "destructive" : "secondary";
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

function RunLabel({ run }: { run: BacktestRun }) {
  const dateStr = run.createdAt
    ? new Date(run.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const cfg = run.config;
  const paramStr = cfg
    ? `目標${cfg.targetPercent}% 指標${cfg.minBuyIndicators}+ RSI${cfg.rsiMin}-${cfg.rsiMax}${cfg.requireMaBuy ? " MA必須" : ""}`
    : "";
  return <span>{dateStr} {paramStr} ({run.count}件)</span>;
}

export default function Backtest() {
  const [selectedRun, setSelectedRun] = useState<string>("latest");
  const [polling, setPolling] = useState(false);
  const [activeTab, setActiveTab] = useState("results");
  const { toast } = useToast();

  const [targetPercent, setTargetPercent] = useState(1.0);
  const [minBuyIndicators, setMinBuyIndicators] = useState(3);
  const [rsiMin, setRsiMin] = useState(0);
  const [rsiMax, setRsiMax] = useState(30);
  const [requireMaBuy, setRequireMaBuy] = useState(false);
  const [simDays, setSimDays] = useState(200);

  const { data: progressData } = useQuery<BacktestProgress>({
    queryKey: ["/api/backtest/progress"],
    refetchInterval: polling ? 2000 : false,
  });

  useEffect(() => {
    if (progressData?.status === "running") {
      setPolling(true);
    } else if (polling && progressData?.status === "completed") {
      setPolling(false);
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/results"] });
    } else if (polling && progressData?.status !== "running") {
      setPolling(false);
    }
  }, [progressData?.status, polling]);

  const { data: runs, isLoading: runsLoading } = useQuery<BacktestRun[]>({
    queryKey: ["/api/backtest/runs"],
  });

  const activeRunId = selectedRun === "latest" ? runs?.[0]?.runId : selectedRun;

  const { data: results, isLoading: resultsLoading } = useQuery<BacktestResult[]>({
    queryKey: ["/api/backtest/results", activeRunId],
    queryFn: () => fetch(`/api/backtest/results${activeRunId ? `?runId=${activeRunId}` : ""}`).then(r => r.json()),
    enabled: !!activeRunId,
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/backtest/run", {
      targetPercent,
      minBuyIndicators,
      rsiMin,
      rsiMax,
      requireMaBuy,
      simDays,
      label: "",
    }),
    onSuccess: () => {
      setPolling(true);
      toast({ title: "バックテスト開始", description: "シミュレーションを実行中です..." });
    },
    onError: (err: any) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("DELETE", `/api/backtest/runs/${runId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/results"] });
      toast({ title: "削除完了", description: "バックテスト結果を削除しました" });
    },
  });

  const stats = useMemo(() => {
    if (!results || results.length === 0) return null;
    const wins = results.filter(r => r.isWin).length;
    const losses = results.length - wins;
    const winRate = Math.round((wins / results.length) * 10000) / 100;
    const totalPL = results.reduce((sum, r) => sum + r.profitLossPercent, 0);
    const avgPL = Math.round((totalPL / results.length) * 100) / 100;
    const totalWinPL = results.filter(r => r.isWin).reduce((s, r) => s + r.profitLossPercent, 0);
    const totalLossPL = Math.abs(results.filter(r => !r.isWin).reduce((s, r) => s + r.profitLossPercent, 0));
    const profitFactor = totalLossPL > 0 ? Math.round((totalWinPL / totalLossPL) * 100) / 100 : totalWinPL > 0 ? Infinity : 0;
    return { wins, losses, winRate, avgPL, total: results.length, profitFactor };
  }, [results]);

  const comparisonData = useMemo(() => {
    if (!runs || runs.length < 2) return null;
    return runs.map(run => {
      const winRate = run.count > 0 ? Math.round((run.wins / run.count) * 10000) / 100 : 0;
      return { ...run, winRate };
    });
  }, [runs]);

  const isRunning = progressData?.status === "running";
  const activeRunConfig = runs?.find(r => r.runId === activeRunId)?.config;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">バックテスト</h1>
          <p className="text-muted-foreground text-sm">条件を変えて複数パターンのシミュレーションを比較</p>
        </div>
      </div>

      {isRunning && progressData && (
        <Card data-testid="card-backtest-progress">
          <CardContent className="pt-4 pb-3 px-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{progressData.message}</span>
              <Badge variant="outline">{progressData.signals}件シグナル</Badge>
            </div>
            <Progress value={progressData.total > 0 ? (progressData.processed / progressData.total) * 100 : 0} />
            {progressData.params && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <Badge variant="outline">目標 {progressData.params.targetPercent}%</Badge>
                <Badge variant="outline">指標 {progressData.params.minBuyIndicators}+</Badge>
                <Badge variant="outline">RSI {progressData.params.rsiMin}-{progressData.params.rsiMax}</Badge>
                {progressData.params.requireMaBuy && <Badge variant="outline">MA必須</Badge>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings2 className="h-5 w-5" />バックテスト条件設定
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
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

                <div className="space-y-3">
                  <Label className="text-sm font-medium">最低買い指標数</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[minBuyIndicators]}
                      onValueChange={([v]) => setMinBuyIndicators(v)}
                      min={2}
                      max={4}
                      step={1}
                      className="flex-1"
                      data-testid="slider-min-indicators"
                    />
                    <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-min-indicators">
                      {minBuyIndicators}/4
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">MACD/RSI/MA/BBのうち何個以上が「買い」でエントリー</p>
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
                      min={80}
                      max={400}
                      step={10}
                      className="flex-1"
                      data-testid="slider-sim-days"
                    />
                    <Badge variant="secondary" className="min-w-[50px] justify-center" data-testid="text-sim-days">
                      {simDays}日
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:col-span-2">
                  <Switch
                    checked={requireMaBuy}
                    onCheckedChange={setRequireMaBuy}
                    data-testid="switch-require-ma"
                  />
                  <div>
                    <Label className="text-sm font-medium">MA（移動平均）買いを必須にする</Label>
                    <p className="text-xs text-muted-foreground">MA5がMA25の上（上昇トレンド）の場合のみエントリー</p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    onClick={() => runMutation.mutate()}
                    disabled={isRunning || runMutation.isPending}
                    data-testid="button-run-backtest"
                  >
                    {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
                    {isRunning ? "実行中..." : "この条件でバックテスト実行"}
                  </Button>
                  <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
                    <Badge variant="outline">目標 {targetPercent.toFixed(1)}%</Badge>
                    <Badge variant="outline">指標 {minBuyIndicators}+</Badge>
                    <Badge variant="outline">RSI {rsiMin}-{rsiMax}</Badge>
                    {requireMaBuy && <Badge variant="outline">MA必須</Badge>}
                    <Badge variant="outline">{simDays}日間</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">プリセット条件</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setTargetPercent(1.0); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(200); }}
                  data-testid="button-preset-default"
                >
                  デフォルト（現行条件）
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setTargetPercent(0.5); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(false); setSimDays(200); }}
                  data-testid="button-preset-low-target"
                >
                  低い利確目標（0.5%）
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setTargetPercent(1.0); setMinBuyIndicators(4); setRsiMin(20); setRsiMax(30); setRequireMaBuy(true); setSimDays(200); }}
                  data-testid="button-preset-strict"
                >
                  厳格フィルター
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setTargetPercent(0.5); setMinBuyIndicators(3); setRsiMin(20); setRsiMax(30); setRequireMaBuy(false); setSimDays(200); }}
                  data-testid="button-preset-conservative"
                >
                  保守的
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setTargetPercent(0.7); setMinBuyIndicators(3); setRsiMin(0); setRsiMax(30); setRequireMaBuy(true); setSimDays(200); }}
                  data-testid="button-preset-trend-follow"
                >
                  トレンドフォロー
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setTargetPercent(2.0); setMinBuyIndicators(4); setRsiMin(0); setRsiMax(25); setRequireMaBuy(true); setSimDays(200); }}
                  data-testid="button-preset-aggressive"
                >
                  積極的（高目標）
                </Button>
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
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">目標%</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">指標数</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">RSI範囲</th>
                        <th className="text-center py-2 px-2 font-medium text-muted-foreground">MA必須</th>
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
                              <Badge variant="outline" className="text-xs">{run.config?.targetPercent ?? "?"}%</Badge>
                            </td>
                            <td className="text-center py-2.5 px-2">
                              <Badge variant="outline" className="text-xs">{run.config?.minBuyIndicators ?? "?"}/4</Badge>
                            </td>
                            <td className="text-center py-2.5 px-2">
                              <Badge variant="outline" className="text-xs">{run.config ? `${run.config.rsiMin}-${run.config.rsiMax}` : "?"}</Badge>
                            </td>
                            <td className="text-center py-2.5 px-2">
                              {run.config?.requireMaBuy
                                ? <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">はい</Badge>
                                : <Badge variant="secondary" className="text-xs">いいえ</Badge>}
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
                  <Badge variant="outline">目標 {activeRunConfig.targetPercent}%</Badge>
                  <Badge variant="outline">指標 {activeRunConfig.minBuyIndicators}+</Badge>
                  <Badge variant="outline">RSI {activeRunConfig.rsiMin}-{activeRunConfig.rsiMax}</Badge>
                  {activeRunConfig.requireMaBuy && <Badge variant="outline">MA必須</Badge>}
                  <Badge variant="outline">{activeRunConfig.simDays}日間</Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {stats && (
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
          )}

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
              {results.map((r) => (
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
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                              <span>シグナル: {r.signalDate}</span>
                              <span>→</span>
                              <span>購入: {r.buyDate}</span>
                              <span>始値 {r.buyPrice.toLocaleString("ja-JP")}円</span>
                              <span>|</span>
                              <span>高値 {r.dayHigh.toLocaleString("ja-JP")}円</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <TrendBadge trend={r.macdTrend} label="MACD" />
                            <TrendBadge trend={r.rsiTrend} label={`RSI${r.rsiValue != null ? ` ${r.rsiValue.toFixed(0)}` : ""}`} />
                            <TrendBadge trend={r.maTrend} label="MA" />
                            <TrendBadge trend={r.bbTrend} label="BB" />
                          </div>
                          <div className={`text-right min-w-[80px] ${r.profitLossPercent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                            <p className="font-bold text-sm" data-testid={`text-pl-${r.id}`}>
                              {r.profitLossPercent >= 0 ? "+" : ""}{r.profitLossPercent.toFixed(2)}%
                            </p>
                            <p className="text-xs">
                              {r.profitLoss >= 0 ? "+" : ""}{r.profitLoss.toLocaleString("ja-JP")}円
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
