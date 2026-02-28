import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Atom, BarChart3, TrendingDown, Shield, RefreshCw,
  AlertTriangle, Percent, Layers, Target, Coins,
  ArrowDown, ArrowRight, Gauge, Activity
} from "lucide-react";

interface PercentileLoss {
  percentile: number;
  loss: number;
}

interface ClassicalVarResult {
  var: number;
  cvar: number;
  simulations: number;
  percentile_losses: PercentileLoss[];
  mean_return: number;
  std_return: number;
}

interface QuantumVarResult {
  var: number;
  cvar: number;
  n_qubits: number;
  n_shots: number;
  amplitude_estimates: { bin: number; z_value: number; probability: number; loss: number }[];
  quantum_probabilities: number[];
  mean_return: number;
  std_return: number;
  tail_probability: number;
  grover_iterations: number;
}

interface VarAsset {
  ticker: string;
  name: string;
  currentPrice: number;
  weight: number;
}

interface VarResponse {
  classical: ClassicalVarResult;
  quantum: QuantumVarResult;
  portfolioValue: number;
  confidenceLevel: number;
  holdingDays: number;
  nAssets: number;
  assets: VarAsset[];
  error?: string;
}

function formatJPY(amount: number): string {
  if (Math.abs(amount) >= 10000) {
    return (amount / 10000).toFixed(1) + "万円";
  }
  return amount.toLocaleString("ja-JP") + "円";
}

function formatFullJPY(amount: number): string {
  return amount.toLocaleString("ja-JP") + "円";
}

function RiskLevelBadge({ var_value, portfolioValue }: { var_value: number; portfolioValue: number }) {
  const ratio = var_value / portfolioValue;
  if (ratio > 0.05) return <Badge className="bg-red-600 text-white" data-testid="badge-risk-high">高リスク</Badge>;
  if (ratio > 0.02) return <Badge className="bg-amber-500 text-white" data-testid="badge-risk-medium">中リスク</Badge>;
  return <Badge className="bg-emerald-600 text-white" data-testid="badge-risk-low">低リスク</Badge>;
}

function VarResultCard({ title, icon: Icon, variant, varResult, portfolioValue }: {
  title: string;
  icon: any;
  variant: "classical" | "quantum";
  varResult: ClassicalVarResult | QuantumVarResult;
  portfolioValue: number;
}) {
  const borderColor = variant === "quantum" ? "border-purple-500/30" : "border-blue-500/30";
  const headerBg = variant === "quantum" ? "bg-purple-500/10" : "bg-blue-500/10";
  const iconColor = variant === "quantum" ? "text-purple-500" : "text-blue-500";

  return (
    <Card className={`${borderColor} border-2`} data-testid={`card-var-${variant}`}>
      <CardHeader className={`${headerBg} pb-3`}>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className={`h-5 w-5 ${iconColor}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              VaR（最大損失額）
            </p>
            <p className="text-2xl font-bold text-red-500" data-testid={`text-var-${variant}`}>
              -{formatJPY(Math.abs(varResult.var))}
            </p>
            <p className="text-xs text-muted-foreground">
              ({(Math.abs(varResult.var) / portfolioValue * 100).toFixed(2)}%)
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              CVaR（条件付きVaR）
            </p>
            <p className="text-2xl font-bold text-orange-500" data-testid={`text-cvar-${variant}`}>
              -{formatJPY(Math.abs(varResult.cvar))}
            </p>
            <p className="text-xs text-muted-foreground">
              ({(Math.abs(varResult.cvar) / portfolioValue * 100).toFixed(2)}%)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <p className="text-xs text-muted-foreground">期待日次リターン</p>
            <p className={`text-sm font-medium ${varResult.mean_return >= 0 ? "text-emerald-500" : "text-red-500"}`}
               data-testid={`text-mean-return-${variant}`}>
              {varResult.mean_return >= 0 ? "+" : ""}{varResult.mean_return.toFixed(4)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">日次ボラティリティ</p>
            <p className="text-sm font-medium" data-testid={`text-std-return-${variant}`}>
              {varResult.std_return.toFixed(4)}%
            </p>
          </div>
        </div>

        {variant === "classical" && "simulations" in varResult && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-2">シミュレーション回数</p>
            <p className="text-sm font-medium" data-testid="text-simulations">
              {(varResult as ClassicalVarResult).simulations.toLocaleString()}回
            </p>
          </div>
        )}

        {variant === "quantum" && "n_qubits" in varResult && (
          <div className="pt-2 border-t space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">量子ビット数</p>
                <p className="text-sm font-medium" data-testid="text-qubits">
                  {(varResult as QuantumVarResult).n_qubits}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">テール確率</p>
                <p className="text-sm font-medium" data-testid="text-tail-prob">
                  {((varResult as QuantumVarResult).tail_probability * 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Grover反復</p>
                <p className="text-sm font-medium" data-testid="text-grover">
                  {(varResult as QuantumVarResult).grover_iterations}回
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function VarAnalysis() {
  const { toast } = useToast();
  const [portfolioValue, setPortfolioValue] = useState(1000000);
  const [confidenceLevel, setConfidenceLevel] = useState(0.95);
  const [holdingDays, setHoldingDays] = useState(1);
  const [nSimulations, setNSimulations] = useState(10000);
  const [nQubits, setNQubits] = useState(6);

  const varMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/var/calculate", {
        portfolioValue,
        confidenceLevel,
        holdingDays,
        nSimulations,
        nQubits,
      });
      return res.json() as Promise<VarResponse>;
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const result = varMutation.data;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Gauge className="h-6 w-6 text-purple-500" />
            量子モンテカルロ VaR分析
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            古典的モンテカルロと量子振幅推定によるValue at Risk比較
          </p>
        </div>
        {result && (
          <RiskLevelBadge var_value={result.classical.var} portfolioValue={result.portfolioValue} />
        )}
      </div>

      <Card data-testid="card-parameters">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" />
            計算パラメータ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1">
                <Coins className="h-3 w-3" />
                ポートフォリオ評価額
              </Label>
              <Input
                type="number"
                value={portfolioValue}
                onChange={(e) => setPortfolioValue(Number(e.target.value))}
                min={10000}
                max={100000000}
                data-testid="input-portfolio-value"
              />
              <p className="text-xs text-muted-foreground">{formatFullJPY(portfolioValue)}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1">
                <Percent className="h-3 w-3" />
                信頼水準: {(confidenceLevel * 100).toFixed(0)}%
              </Label>
              <Slider
                value={[confidenceLevel * 100]}
                onValueChange={([v]) => setConfidenceLevel(v / 100)}
                min={90}
                max={99}
                step={1}
                data-testid="slider-confidence"
              />
              <p className="text-xs text-muted-foreground">VaR算出時の信頼区間</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1">
                <Activity className="h-3 w-3" />
                保有日数: {holdingDays}日
              </Label>
              <Slider
                value={[holdingDays]}
                onValueChange={([v]) => setHoldingDays(v)}
                min={1}
                max={30}
                step={1}
                data-testid="slider-holding-days"
              />
              <p className="text-xs text-muted-foreground">リスク評価期間</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                シミュレーション数
              </Label>
              <Input
                type="number"
                value={nSimulations}
                onChange={(e) => setNSimulations(Number(e.target.value))}
                min={1000}
                max={100000}
                step={1000}
                data-testid="input-simulations"
              />
              <p className="text-xs text-muted-foreground">古典MC試行回数</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1">
                <Atom className="h-3 w-3" />
                量子ビット数: {nQubits}
              </Label>
              <Slider
                value={[nQubits]}
                onValueChange={([v]) => setNQubits(v)}
                min={4}
                max={10}
                step={1}
                data-testid="slider-qubits"
              />
              <p className="text-xs text-muted-foreground">振幅推定の精度（2^n bins）</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => varMutation.mutate()}
              disabled={varMutation.isPending}
              className="gap-2"
              data-testid="button-calculate-var"
            >
              {varMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  計算中...
                </>
              ) : (
                <>
                  <Gauge className="h-4 w-4" />
                  VaR計算実行
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {varMutation.isPending && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {result && !varMutation.isPending && (
        <>
          {result.error && (
            <Card className="border-amber-500/30 border-2">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm">{result.error}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VarResultCard
              title="古典的モンテカルロ"
              icon={BarChart3}
              variant="classical"
              varResult={result.classical}
              portfolioValue={result.portfolioValue}
            />
            <VarResultCard
              title="量子モンテカルロ（振幅推定）"
              icon={Atom}
              variant="quantum"
              varResult={result.quantum}
              portfolioValue={result.portfolioValue}
            />
          </div>

          <Card data-testid="card-comparison">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowRight className="h-4 w-4" />
                手法比較
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">指標</th>
                      <th className="text-right py-2 px-3">古典MC</th>
                      <th className="text-right py-2 px-3">量子MC</th>
                      <th className="text-right py-2 px-3">差分</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b" data-testid="row-compare-var">
                      <td className="py-2 px-3 font-medium">VaR</td>
                      <td className="text-right py-2 px-3 text-red-500">-{formatFullJPY(Math.abs(result.classical.var))}</td>
                      <td className="text-right py-2 px-3 text-red-500">-{formatFullJPY(Math.abs(result.quantum.var))}</td>
                      <td className="text-right py-2 px-3">
                        {formatFullJPY(Math.abs(result.quantum.var - result.classical.var))}
                      </td>
                    </tr>
                    <tr className="border-b" data-testid="row-compare-cvar">
                      <td className="py-2 px-3 font-medium">CVaR</td>
                      <td className="text-right py-2 px-3 text-orange-500">-{formatFullJPY(Math.abs(result.classical.cvar))}</td>
                      <td className="text-right py-2 px-3 text-orange-500">-{formatFullJPY(Math.abs(result.quantum.cvar))}</td>
                      <td className="text-right py-2 px-3">
                        {formatFullJPY(Math.abs(result.quantum.cvar - result.classical.cvar))}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-3 font-medium">期待リターン</td>
                      <td className="text-right py-2 px-3">{result.classical.mean_return.toFixed(4)}%</td>
                      <td className="text-right py-2 px-3">{result.quantum.mean_return.toFixed(4)}%</td>
                      <td className="text-right py-2 px-3">-</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-3 font-medium">ボラティリティ</td>
                      <td className="text-right py-2 px-3">{result.classical.std_return.toFixed(4)}%</td>
                      <td className="text-right py-2 px-3">{result.quantum.std_return.toFixed(4)}%</td>
                      <td className="text-right py-2 px-3">-</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium">計算手法</td>
                      <td className="text-right py-2 px-3">{result.classical.simulations.toLocaleString()}回MC</td>
                      <td className="text-right py-2 px-3">{result.quantum.n_qubits}量子ビット振幅推定</td>
                      <td className="text-right py-2 px-3">-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {result.classical.percentile_losses.length > 0 && (
            <Card data-testid="card-percentile">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowDown className="h-4 w-4" />
                  古典MC損失分布（パーセンタイル）
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3">パーセンタイル</th>
                        {result.classical.percentile_losses.map(p => (
                          <th key={p.percentile} className="text-right py-2 px-3">{p.percentile}%</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="py-2 px-3 font-medium">損失額</td>
                        {result.classical.percentile_losses.map(p => (
                          <td key={p.percentile} className={`text-right py-2 px-3 ${p.loss > 0 ? "text-red-500" : "text-emerald-500"}`}>
                            {p.loss > 0 ? "-" : "+"}{formatJPY(Math.abs(p.loss))}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex gap-2 flex-wrap">
                  {result.classical.percentile_losses.map(p => {
                    const ratio = Math.abs(p.loss) / result.portfolioValue;
                    const width = Math.min(100, ratio * 500);
                    return (
                      <div key={p.percentile} className="flex-1 min-w-[60px]">
                        <div className="text-xs text-center text-muted-foreground mb-1">{p.percentile}%</div>
                        <div className="h-8 bg-muted rounded relative overflow-hidden">
                          <div
                            className={`h-full rounded ${p.loss > 0 ? "bg-red-500/60" : "bg-emerald-500/60"}`}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <div className="text-xs text-center mt-1">
                          {p.loss > 0 ? "-" : "+"}{formatJPY(Math.abs(p.loss))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {result.quantum.amplitude_estimates.length > 0 && (
            <Card data-testid="card-quantum-detail">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="h-4 w-4 text-purple-500" />
                  量子振幅推定の詳細
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="p-3 bg-purple-500/5 rounded-lg">
                    <p className="text-xs text-muted-foreground">量子ビット数</p>
                    <p className="text-lg font-bold">{result.quantum.n_qubits}</p>
                  </div>
                  <div className="p-3 bg-purple-500/5 rounded-lg">
                    <p className="text-xs text-muted-foreground">ビン数（精度）</p>
                    <p className="text-lg font-bold">{Math.pow(2, result.quantum.n_qubits)}</p>
                  </div>
                  <div className="p-3 bg-purple-500/5 rounded-lg">
                    <p className="text-xs text-muted-foreground">テール確率</p>
                    <p className="text-lg font-bold">{(result.quantum.tail_probability * 100).toFixed(2)}%</p>
                  </div>
                  <div className="p-3 bg-purple-500/5 rounded-lg">
                    <p className="text-xs text-muted-foreground">Grover反復回数</p>
                    <p className="text-lg font-bold">{result.quantum.grover_iterations}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-2">確率振幅分布（上位16ビン）</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1 px-2">ビン</th>
                        <th className="text-right py-1 px-2">z値</th>
                        <th className="text-right py-1 px-2">確率</th>
                        <th className="text-right py-1 px-2">対応損失額</th>
                        <th className="text-left py-1 px-2 w-32">分布</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.quantum.amplitude_estimates.map((est) => {
                        const maxProb = Math.max(...result.quantum.amplitude_estimates.map(e => e.probability));
                        const barWidth = maxProb > 0 ? (est.probability / maxProb) * 100 : 0;
                        return (
                          <tr key={est.bin} className="border-b last:border-b-0">
                            <td className="py-1 px-2">{est.bin}</td>
                            <td className="text-right py-1 px-2">{est.z_value.toFixed(2)}</td>
                            <td className="text-right py-1 px-2">{(est.probability * 100).toFixed(3)}%</td>
                            <td className={`text-right py-1 px-2 ${est.loss > 0 ? "text-red-500" : "text-emerald-500"}`}>
                              {est.loss > 0 ? "-" : "+"}{formatJPY(Math.abs(est.loss))}
                            </td>
                            <td className="py-1 px-2">
                              <div className="h-3 bg-muted rounded overflow-hidden">
                                <div className="h-full bg-purple-500/60 rounded" style={{ width: `${barWidth}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {result.assets.length > 0 && (
            <Card data-testid="card-assets">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4" />
                  対象ポートフォリオ ({result.nAssets}銘柄)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3">銘柄</th>
                        <th className="text-left py-2 px-3">名称</th>
                        <th className="text-right py-2 px-3">現在価格</th>
                        <th className="text-right py-2 px-3">ウェイト</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.assets.map((asset) => (
                        <tr key={asset.ticker} className="border-b last:border-b-0" data-testid={`row-asset-${asset.ticker}`}>
                          <td className="py-2 px-3 font-mono font-medium">{asset.ticker}</td>
                          <td className="py-2 px-3">{asset.name}</td>
                          <td className="text-right py-2 px-3">{formatFullJPY(asset.currentPrice)}</td>
                          <td className="text-right py-2 px-3">{(asset.weight * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-muted/30" data-testid="card-explanation">
            <CardContent className="pt-4">
              <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Atom className="h-4 w-4 text-purple-500" />
                量子モンテカルロとは
              </h3>
              <div className="text-xs text-muted-foreground space-y-2">
                <p>
                  <strong>古典的モンテカルロ：</strong>
                  正規分布に従うランダムな価格変動を大量にシミュレーションし、指定した信頼水準での最大損失額（VaR）を推定します。
                  精度はシミュレーション回数Nに対して1/√Nの速度で改善します。
                </p>
                <p>
                  <strong>量子モンテカルロ（振幅推定）：</strong>
                  量子コンピュータの振幅推定アルゴリズムを使い、損失分布をn量子ビットで2^nのビンに離散化して符号化します。
                  Grover演算子を応用した振幅推定により、古典的手法の<strong>二乗速度向上</strong>（1/N vs 1/√N）が理論的に達成可能です。
                  現在はシミュレーター上で動作しており、実量子ハードウェアでの実行時に真の速度向上が得られます。
                </p>
                <p>
                  <strong>CVaR（条件付きVaR）：</strong>
                  VaRを超える損失が発生した場合の平均損失額です。テールリスク（極端な損失）をより適切に捉えます。
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!result && !varMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Gauge className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="font-medium text-lg mb-2">VaR分析を実行</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              パラメータを設定し「VaR計算実行」ボタンを押してください。
              ポートフォリオ保有銘柄、ウォッチリスト銘柄、または登録銘柄を対象に
              古典的モンテカルロと量子モンテカルロの両方でリスクを計算します。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
