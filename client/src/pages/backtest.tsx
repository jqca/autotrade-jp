import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayCircle, Trophy, TrendingDown, BarChart3, Trash2, Loader2, CheckCircle, XCircle } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BacktestResult } from "@shared/schema";

interface BacktestRun {
  runId: string;
  count: number;
  wins: number;
  losses: number;
  createdAt: string | null;
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
}

function TrendBadge({ trend, label }: { trend: string | null; label: string }) {
  const variant = trend === "buy" ? "default" : trend === "sell" ? "destructive" : "secondary";
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

export default function Backtest() {
  const [selectedRun, setSelectedRun] = useState<string>("latest");
  const [polling, setPolling] = useState(false);
  const { toast } = useToast();

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
    mutationFn: () => apiRequest("POST", "/api/backtest/run"),
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
    const maxWin = Math.max(...results.map(r => r.profitLossPercent));
    const maxLoss = Math.min(...results.map(r => r.profitLossPercent));
    return { wins, losses, winRate, avgPL, maxWin, maxLoss, total: results.length };
  }, [results]);

  const isRunning = progressData?.status === "running";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">バックテスト</h1>
          <p className="text-muted-foreground">強い買いシグナル → 翌営業日始値で購入、高値が始値+1%以上で勝ち（過去200日分）</p>
        </div>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={isRunning || runMutation.isPending}
          data-testid="button-run-backtest"
        >
          {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
          {isRunning ? "実行中..." : "バックテスト実行"}
        </Button>
      </div>

      {isRunning && progressData && (
        <Card data-testid="card-backtest-progress">
          <CardContent className="pt-4 pb-3 px-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{progressData.message}</span>
              <Badge variant="outline">{progressData.signals}件シグナル</Badge>
            </div>
            <Progress value={progressData.total > 0 ? (progressData.processed / progressData.total) * 100 : 0} />
          </CardContent>
        </Card>
      )}

      {stats && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
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
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {runs && runs.length > 0 && (
          <Select value={selectedRun} onValueChange={setSelectedRun}>
            <SelectTrigger className="w-[280px]" data-testid="select-backtest-run">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">最新の結果</SelectItem>
              {runs.map(run => (
                <SelectItem key={run.runId} value={run.runId}>
                  {run.createdAt ? new Date(run.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : run.runId}
                  {" "}({run.count}件)
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
              「バックテスト実行」ボタンを押して、過去データでのシミュレーションを開始してください
            </p>
          </CardContent>
        </Card>
      ) : !results || results.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <h3 className="font-semibold mb-1">この実行では強い買いシグナルが検出されませんでした</h3>
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
                          <span>|</span>
                          <span>目標 {(Math.round(r.buyPrice * 1.01 * 100) / 100).toLocaleString("ja-JP")}円</span>
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
    </div>
  );
}
