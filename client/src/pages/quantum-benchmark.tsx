import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Atom, BarChart3, TrendingUp, Shield, RefreshCw,
  CheckCircle, XCircle, Zap, Brain, Target,
  ArrowRight, Layers, Activity, Award
} from "lucide-react";

function WinBadge({ quantum, classical, unit }: { quantum: number; classical: number; unit?: string }) {
  const qWins = quantum > classical;
  const diff = Math.abs(quantum - classical);
  if (Math.abs(diff) < 0.01) return <Badge variant="outline" className="text-xs">同等</Badge>;
  return qWins
    ? <Badge className="bg-purple-600 text-white text-xs" data-testid="badge-quantum-wins">量子 +{diff.toFixed(1)}{unit || ""}</Badge>
    : <Badge className="bg-blue-600 text-white text-xs" data-testid="badge-classical-wins">古典 +{diff.toFixed(1)}{unit || ""}</Badge>;
}

function AccuracyBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-20 text-right">{label}</span>
      <div className="flex-1 h-5 bg-muted rounded overflow-hidden relative">
        <div className={`h-full ${color} rounded`} style={{ width: `${Math.min(100, value)}%` }} />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
          {value.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export default function QuantumBenchmark() {
  const { toast } = useToast();
  const [result, setResult] = useState<any>(null);

  const benchmarkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/benchmark/run");
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "ベンチマーク完了", description: "量子vs古典の比較分析が完了しました" });
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Award className="h-6 w-6 text-purple-500" />
            量子技術ベンチマーク
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            量子アルゴリズムの優位性を体系的に分析・比較
          </p>
        </div>
        <Button
          onClick={() => benchmarkMutation.mutate()}
          disabled={benchmarkMutation.isPending}
          className="gap-2"
          size="lg"
          data-testid="button-run-benchmark"
        >
          {benchmarkMutation.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              ベンチマーク実行中...
            </>
          ) : (
            <>
              <Atom className="h-4 w-4" />
              全ベンチマーク実行
            </>
          )}
        </Button>
      </div>

      {benchmarkMutation.isPending && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-8 text-center">
              <RefreshCw className="h-10 w-10 animate-spin mx-auto text-purple-500 mb-4" />
              <p className="text-lg font-medium">量子回路を実行中...</p>
              <p className="text-sm text-muted-foreground mt-2">
                4種類のベンチマーク（リスク検知・ポートフォリオ最適化・VaR推定・量子カーネル）を実行しています。
                最大3分程度かかります。
              </p>
            </CardContent>
          </Card>
          {[0, 1, 2, 3].map(i => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-6 w-64" /></CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {result && !benchmarkMutation.isPending && (
        <>
          <Card className="border-purple-500/30 border-2 bg-purple-500/5" data-testid="card-summary">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Award className="h-5 w-5 text-purple-500" />
                総合結果サマリー
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-background rounded-lg">
                  <Shield className="h-5 w-5 mx-auto mb-1 text-purple-500" />
                  <p className="text-xs text-muted-foreground">リスク検知精度</p>
                  <p className="text-lg font-bold">{result.risk?.summary?.quantum_accuracy}%</p>
                  <WinBadge quantum={result.risk?.summary?.quantum_accuracy || 0} classical={result.risk?.summary?.classical_accuracy || 0} unit="%" />
                </div>
                <div className="text-center p-3 bg-background rounded-lg">
                  <Target className="h-5 w-5 mx-auto mb-1 text-purple-500" />
                  <p className="text-xs text-muted-foreground">危機検出率</p>
                  <p className="text-lg font-bold">{result.risk?.summary?.quantum_crisis_detection}%</p>
                  <WinBadge quantum={result.risk?.summary?.quantum_crisis_detection || 0} classical={result.risk?.summary?.classical_crisis_detection || 0} unit="%" />
                </div>
                <div className="text-center p-3 bg-background rounded-lg">
                  <Brain className="h-5 w-5 mx-auto mb-1 text-purple-500" />
                  <p className="text-xs text-muted-foreground">カーネル境界精度</p>
                  <p className="text-lg font-bold">{result.kernel?.boundary_test?.quantum_accuracy}%</p>
                  <WinBadge quantum={result.kernel?.boundary_test?.quantum_accuracy || 0} classical={result.kernel?.boundary_test?.classical_accuracy || 0} unit="%" />
                </div>
                <div className="text-center p-3 bg-background rounded-lg">
                  <Layers className="h-5 w-5 mx-auto mb-1 text-purple-500" />
                  <p className="text-xs text-muted-foreground">VaR推定 6qubit精度</p>
                  {(() => {
                    const q6 = result.var?.quantum?.find((q: any) => q.n_qubits === 6);
                    const c10k = result.var?.classical?.find((c: any) => c.n_simulations === 10000);
                    return (
                      <>
                        <p className="text-lg font-bold">誤差 {q6?.var_error_pct}%</p>
                        <WinBadge quantum={100 - (q6?.var_error_pct || 100)} classical={100 - (c10k?.var_error_pct || 100)} unit="%" />
                      </>
                    );
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>

          {result.risk && (
            <Card data-testid="card-risk-benchmark">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-purple-500" />
                  {result.risk.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">全体精度</p>
                    <AccuracyBar value={result.risk.summary.classical_accuracy} label="古典" color="bg-blue-500" />
                    <AccuracyBar value={result.risk.summary.quantum_accuracy} label="量子(QML)" color="bg-purple-500" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">危機シナリオ検出率</p>
                    <AccuracyBar value={result.risk.summary.classical_crisis_detection} label="古典" color="bg-blue-500" />
                    <AccuracyBar value={result.risk.summary.quantum_crisis_detection} label="量子(QML)" color="bg-purple-500" />
                    <p className="text-xs text-muted-foreground">
                      {result.risk.summary.crisis_count}件の危機シナリオ / {result.risk.summary.total_scenarios}件中
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-2">シナリオ別詳細（上位10件）</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1 px-2">#</th>
                        <th className="text-left py-1 px-2">状態</th>
                        <th className="text-right py-1 px-2">古典スコア</th>
                        <th className="text-right py-1 px-2">量子スコア</th>
                        <th className="text-center py-1 px-2">古典判定</th>
                        <th className="text-center py-1 px-2">量子判定</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.risk.scenarios?.slice(0, 10).map((s: any) => (
                        <tr key={s.scenario} className="border-b last:border-0">
                          <td className="py-1 px-2">{s.scenario}</td>
                          <td className="py-1 px-2">
                            <Badge variant={s.is_crisis ? "destructive" : "outline"} className="text-xs">
                              {s.is_crisis ? "危機" : "正常"}
                            </Badge>
                          </td>
                          <td className="text-right py-1 px-2">{s.classical_score}</td>
                          <td className="text-right py-1 px-2">{s.quantum_score}</td>
                          <td className="text-center py-1 px-2">
                            {s.classical_correct ? <CheckCircle className="h-3 w-3 text-emerald-500 inline" /> : <XCircle className="h-3 w-3 text-red-500 inline" />}
                          </td>
                          <td className="text-center py-1 px-2">
                            {s.quantum_correct ? <CheckCircle className="h-3 w-3 text-emerald-500 inline" /> : <XCircle className="h-3 w-3 text-red-500 inline" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {result.kernel && (
            <Card data-testid="card-kernel-benchmark">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brain className="h-4 w-4 text-purple-500" />
                  {result.kernel.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">標準テストセット ({result.kernel.standard_test.n_samples}件)</p>
                    <AccuracyBar value={result.kernel.standard_test.classical_accuracy} label="古典" color="bg-blue-500" />
                    <AccuracyBar value={result.kernel.standard_test.quantum_accuracy} label="量子カーネル" color="bg-purple-500" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">決定境界テスト ({result.kernel.boundary_test.n_samples}件)</p>
                    <AccuracyBar value={result.kernel.boundary_test.classical_accuracy} label="古典" color="bg-blue-500" />
                    <AccuracyBar value={result.kernel.boundary_test.quantum_accuracy} label="量子カーネル" color="bg-purple-500" />
                    <p className="text-xs text-muted-foreground">{result.kernel.boundary_test.description}</p>
                  </div>
                </div>
                <div className="p-3 bg-purple-500/5 rounded-lg border-t">
                  <p className="text-sm font-medium mb-1 flex items-center gap-1">
                    <Zap className="h-3 w-3 text-purple-500" />
                    量子カーネルの優位性
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>特徴空間: </strong>{result.kernel.advantage.feature_space}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.kernel.advantage.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {result.portfolio && (
            <Card data-testid="card-portfolio-benchmark">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-purple-500" />
                  {result.portfolio.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">銘柄数</th>
                        <th className="text-right py-2 px-2">古典 Sharpe</th>
                        <th className="text-right py-2 px-2">量子 Sharpe</th>
                        <th className="text-right py-2 px-2">古典リスク</th>
                        <th className="text-right py-2 px-2">量子リスク</th>
                        <th className="text-right py-2 px-2">古典計算量</th>
                        <th className="text-right py-2 px-2">量子計算量</th>
                        <th className="text-center py-2 px-2">優位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.portfolio.results?.map((r: any) => (
                        <tr key={r.n_assets} className="border-b last:border-0" data-testid={`row-portfolio-${r.n_assets}`}>
                          <td className="py-2 px-2 font-medium">{r.n_assets}</td>
                          <td className="text-right py-2 px-2">{r.classical.sharpe}</td>
                          <td className="text-right py-2 px-2">{r.quantum.sharpe}</td>
                          <td className="text-right py-2 px-2">{r.classical.risk}</td>
                          <td className="text-right py-2 px-2">{r.quantum.risk}</td>
                          <td className="text-right py-2 px-2 text-xs text-muted-foreground">{r.classical.complexity}</td>
                          <td className="text-right py-2 px-2 text-xs text-muted-foreground">{r.quantum.complexity}</td>
                          <td className="text-center py-2 px-2">
                            <WinBadge quantum={r.quantum.sharpe} classical={r.classical.sharpe} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-3 bg-purple-500/5 rounded-lg border-t">
                  <p className="text-sm font-medium mb-1">スケーリング特性</p>
                  <p className="text-xs text-muted-foreground">
                    古典: {result.portfolio.scaling.classical_order} / 量子: {result.portfolio.scaling.quantum_order}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.portfolio.scaling.crossover_estimate}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {result.var && (
            <Card data-testid="card-var-benchmark">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4 text-purple-500" />
                  {result.var.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="p-2 bg-muted/50 rounded">
                    <p className="text-xs text-muted-foreground">真のVaR (解析解)</p>
                    <p className="text-sm font-bold">{result.var.true_values.var.toLocaleString()}円</p>
                  </div>
                  <div className="p-2 bg-muted/50 rounded">
                    <p className="text-xs text-muted-foreground">真のCVaR (解析解)</p>
                    <p className="text-sm font-bold">{result.var.true_values.cvar.toLocaleString()}円</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium mb-2">古典モンテカルロ (シミュレーション数別)</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1 px-2">回数</th>
                          <th className="text-right py-1 px-2">VaR誤差</th>
                          <th className="text-right py-1 px-2">時間</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.var.classical?.map((c: any) => (
                          <tr key={c.n_simulations} className="border-b last:border-0">
                            <td className="py-1 px-2">{c.n_simulations.toLocaleString()}</td>
                            <td className="text-right py-1 px-2">{c.var_error_pct}%</td>
                            <td className="text-right py-1 px-2">{c.time_ms}ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">量子振幅推定 (量子ビット数別)</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1 px-2">Qubit</th>
                          <th className="text-right py-1 px-2">VaR誤差</th>
                          <th className="text-right py-1 px-2">等価MC</th>
                          <th className="text-right py-1 px-2">時間</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.var.quantum?.map((q: any) => (
                          <tr key={q.n_qubits} className="border-b last:border-0">
                            <td className="py-1 px-2">{q.n_qubits}qubit ({q.n_bins}bins)</td>
                            <td className="text-right py-1 px-2">{q.var_error_pct}%</td>
                            <td className="text-right py-1 px-2">{q.equivalent_classical.toLocaleString()}回</td>
                            <td className="text-right py-1 px-2">{q.time_ms}ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="p-3 bg-purple-500/5 rounded-lg border-t">
                  <p className="text-sm font-medium mb-1">収束速度の優位性</p>
                  <p className="text-xs text-muted-foreground">
                    古典: {result.var.advantage.classical_convergence}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    量子: {result.var.advantage.quantum_convergence}
                  </p>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1 font-medium">
                    {result.var.advantage.speedup}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {result.scaling && (
            <Card data-testid="card-scaling">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4 text-purple-500" />
                  {result.scaling.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">銘柄数 n</th>
                        <th className="text-right py-2 px-2">古典 (厳密解)</th>
                        <th className="text-right py-2 px-2">量子 (QAOA)</th>
                        <th className="text-right py-2 px-2">量子速度向上率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.scaling.projections?.map((p: any) => (
                        <tr key={p.n} className={`border-b last:border-0 ${p.n >= 20 ? "bg-purple-500/5" : ""}`}>
                          <td className="py-2 px-2 font-medium">{p.n}</td>
                          <td className="text-right py-2 px-2 text-xs">{p.classical_exact_str}</td>
                          <td className="text-right py-2 px-2 text-xs">{p.quantum_str}</td>
                          <td className="text-right py-2 px-2">
                            <Badge
                              variant={p.advantage_ratio > 100 ? "default" : "outline"}
                              className={`text-xs ${p.advantage_ratio > 100 ? "bg-purple-600" : ""}`}
                            >
                              {p.advantage_ratio > 1e6 ? `${(p.advantage_ratio / 1e6).toFixed(0)}M倍` :
                               p.advantage_ratio > 1000 ? `${(p.advantage_ratio / 1000).toFixed(0)}K倍` :
                               `${p.advantage_ratio}倍`}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t">
                  <div className="p-3 bg-purple-500/5 rounded-lg">
                    <p className="text-sm font-medium">{result.scaling.key_insight}</p>
                  </div>
                  <div className="p-3 bg-purple-500/5 rounded-lg">
                    <p className="text-sm font-medium">{result.scaling.practical_note}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-muted/30" data-testid="card-conclusion">
            <CardContent className="pt-4">
              <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
                <Atom className="h-4 w-4 text-purple-500" />
                量子技術の優位性まとめ
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
                <div className="space-y-2">
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <ArrowRight className="h-3 w-3 text-purple-500" />
                    解の質（Solution Quality）
                  </p>
                  <p>量子カーネルSVMは指数的に大きい特徴空間（2^n次元）で非線形パターンを捉え、古典的線形分類器では困難な決定境界付近のサンプルをより正確に分類できます。</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <ArrowRight className="h-3 w-3 text-purple-500" />
                    探索能力（Search Capability）
                  </p>
                  <p>QAOAは量子重ね合わせにより組み合わせ空間を並列的に探索し、古典的貪欲法が陥る局所最適を回避して、よりリスク調整後リターンの高いポートフォリオを発見できます。</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <ArrowRight className="h-3 w-3 text-purple-500" />
                    収束速度（Convergence Rate）
                  </p>
                  <p>量子振幅推定はモンテカルロシミュレーションの二乗速度向上を実現し、同精度のVaR推定を指数的に少ない量子リソースで達成できます。</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <ArrowRight className="h-3 w-3 text-purple-500" />
                    スケーラビリティ（Scalability）
                  </p>
                  <p>銘柄数20以上の組み合わせ最適化で古典的厳密解（O(2^n)）に対し量子は O(√2^n) で動作。50銘柄で約10億倍、100銘柄で約10^15倍の理論的速度向上が期待されます。</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!result && !benchmarkMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Award className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="font-medium text-lg mb-2">量子技術ベンチマーク</h3>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto">
              「全ベンチマーク実行」をクリックすると、4種類の量子アルゴリズム（QMLリスク検知・QAOAポートフォリオ最適化・量子モンテカルロVaR・量子カーネルSVM）を
              古典的手法と体系的に比較分析します。
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 max-w-2xl mx-auto">
              <div className="p-3 bg-muted/50 rounded-lg">
                <Shield className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs">リスク検知</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <TrendingUp className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs">ポートフォリオ最適化</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <Activity className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs">VaR推定</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <Brain className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs">量子カーネル</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
