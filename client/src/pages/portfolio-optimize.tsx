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
  Atom, BarChart3, PieChart, TrendingUp, Shield,
  RefreshCw, ArrowRight, Coins, Target, Percent, Layers
} from "lucide-react";

interface SelectedAsset {
  ticker: string;
  name: string;
  currentPrice: number;
  allocation: number;
  shares: number;
  investAmount: number;
  expectedReturn: number;
  weight: number;
}

interface OptResult {
  method: string;
  budget: number;
  selectedAssets: SelectedAsset[];
  totalInvested: number;
  remainingCash: number;
  portfolioExpectedReturn: number;
  portfolioRisk: number;
  sharpeRatio: number;
  diversificationScore: number;
}

interface Candidate {
  ticker: string;
  name: string;
  currentPrice: number;
  expectedReturn: number;
  signal: string;
  signalLabel: string;
  rsiValue: number | null;
}

interface QaoaDetails {
  nAssets: number;
  nLayers: number;
  qaoaMethod: string;
  topSolutions: { selection: number[]; probability: number; cost: number }[];
}

interface OptResponse {
  classical: OptResult;
  quantum: OptResult;
  qaoaDetails: QaoaDetails;
  candidates: Candidate[];
  covMatrix: number[][];
}

function formatJPY(amount: number): string {
  return amount.toLocaleString("ja-JP") + "円";
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === "strong_buy") return <Badge className="bg-emerald-600 text-white text-xs">強い買い</Badge>;
  if (signal === "buy") return <Badge className="bg-emerald-500/80 text-white text-xs">買い</Badge>;
  return <Badge variant="outline" className="text-xs">{signal}</Badge>;
}

function PortfolioCard({ result, title, icon: Icon, variant }: {
  result: OptResult;
  title: string;
  icon: any;
  variant: "classical" | "quantum";
}) {
  const totalWeight = result.selectedAssets.reduce((sum, a) => sum + a.weight, 0);

  return (
    <Card data-testid={`card-portfolio-${variant}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="h-5 w-5" />
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {variant === "classical" ? "マーコウィッツ平均分散最適化" : "QAOA量子近似最適化アルゴリズム"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">投資額</p>
            <p className="text-sm font-bold">{formatJPY(result.totalInvested)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">期待リターン</p>
            <p className={`text-sm font-bold ${result.portfolioExpectedReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {result.portfolioExpectedReturn >= 0 ? "+" : ""}{result.portfolioExpectedReturn.toFixed(2)}%
            </p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">リスク</p>
            <p className="text-sm font-bold">{result.portfolioRisk.toFixed(2)}%</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">シャープ比</p>
            <p className="text-sm font-bold">{result.sharpeRatio.toFixed(3)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5" />
          <span>分散スコア: {result.diversificationScore.toFixed(1)} / 100</span>
          <span className="mx-1">|</span>
          <Coins className="h-3.5 w-3.5" />
          <span>余剰資金: {formatJPY(result.remainingCash)}</span>
        </div>

        {result.selectedAssets.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium">銘柄配分 ({result.selectedAssets.length}銘柄)</p>
            <div className="space-y-1.5">
              {result.selectedAssets.map((asset) => (
                <div key={asset.ticker} className="flex items-center gap-2 py-1.5 px-2 bg-muted/20 rounded text-sm" data-testid={`asset-${variant}-${asset.ticker}`}>
                  <span className="font-mono text-xs w-12">{asset.ticker}</span>
                  <span className="flex-1 truncate text-xs">{asset.name}</span>
                  <span className="text-xs text-muted-foreground">{asset.shares}株</span>
                  <span className="text-xs font-medium w-20 text-right">{formatJPY(asset.investAmount)}</span>
                  <div className="w-16">
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${variant === "quantum" ? "bg-purple-500" : "bg-blue-500"}`}
                        style={{ width: `${totalWeight > 0 ? (asset.weight / totalWeight) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground w-10 text-right">
                    {totalWeight > 0 ? ((asset.weight / totalWeight) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            予算内で購入可能な銘柄がありません
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PortfolioOptimize() {
  const { toast } = useToast();
  const [budget, setBudget] = useState(1000000);
  const [riskAversion, setRiskAversion] = useState(0.5);
  const [maxAssets, setMaxAssets] = useState(10);
  const [result, setResult] = useState<OptResponse | null>(null);

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/portfolio/optimize", {
        budget,
        riskAversion,
        maxAssets,
      });
      return res.json() as Promise<OptResponse>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "最適化完了", description: "古典的手法とQAOAの両方でポートフォリオを最適化しました" });
    },
    onError: (err: any) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const riskLabel = riskAversion <= 0.3 ? "積極的" : riskAversion <= 0.7 ? "バランス" : riskAversion <= 1.2 ? "慎重" : "保守的";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-portfolio-optimize">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">量子ポートフォリオ最適化</h1>
        <p className="text-sm text-muted-foreground mt-1">
          買いシグナル銘柄から最適な分散投資ポートフォリオを構築 — 古典的手法 vs QAOA量子最適化
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            最適化パラメータ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="budget">投資予算</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="budget"
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  min={10000}
                  max={100000000}
                  step={100000}
                  data-testid="input-budget"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">円</span>
              </div>
              <p className="text-xs text-muted-foreground">{formatJPY(budget)}</p>
            </div>

            <div className="space-y-2">
              <Label>リスク回避度: {riskAversion.toFixed(1)} ({riskLabel})</Label>
              <Slider
                value={[riskAversion]}
                onValueChange={([v]) => setRiskAversion(v)}
                min={0}
                max={2}
                step={0.1}
                data-testid="slider-risk"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>積極的</span>
                <span>保守的</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>最大銘柄数: {maxAssets}</Label>
              <Slider
                value={[maxAssets]}
                onValueChange={([v]) => setMaxAssets(v)}
                min={2}
                max={15}
                step={1}
                data-testid="slider-max-assets"
              />
              <p className="text-xs text-muted-foreground">買いシグナル上位から最大{maxAssets}銘柄を候補</p>
            </div>
          </div>

          <div className="mt-4">
            <Button
              onClick={() => optimizeMutation.mutate()}
              disabled={optimizeMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-optimize"
            >
              {optimizeMutation.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />最適化中（量子回路計算中）...</>
              ) : (
                <><Atom className="h-4 w-4 mr-2" />ポートフォリオ最適化実行</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {optimizeMutation.isPending && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      )}

      {result && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <PortfolioCard result={result.classical} title="古典的最適化" icon={BarChart3} variant="classical" />
            <PortfolioCard result={result.quantum} title="QAOA量子最適化" icon={Atom} variant="quantum" />
          </div>

          <Card data-testid="card-comparison">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <PieChart className="h-5 w-5" />
                手法比較
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">指標</th>
                      <th className="text-right py-2 px-2 text-blue-600 dark:text-blue-400 font-medium">古典的</th>
                      <th className="text-right py-2 px-2 text-purple-600 dark:text-purple-400 font-medium">QAOA</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">差分</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 px-2 flex items-center gap-1"><Coins className="h-3.5 w-3.5" />投資額</td>
                      <td className="text-right py-2 px-2">{formatJPY(result.classical.totalInvested)}</td>
                      <td className="text-right py-2 px-2">{formatJPY(result.quantum.totalInvested)}</td>
                      <td className="text-right py-2 px-2 text-muted-foreground">{formatJPY(Math.abs(result.classical.totalInvested - result.quantum.totalInvested))}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" />期待リターン</td>
                      <td className="text-right py-2 px-2">{result.classical.portfolioExpectedReturn.toFixed(2)}%</td>
                      <td className="text-right py-2 px-2">{result.quantum.portfolioExpectedReturn.toFixed(2)}%</td>
                      <td className="text-right py-2 px-2 text-muted-foreground">{Math.abs(result.classical.portfolioExpectedReturn - result.quantum.portfolioExpectedReturn).toFixed(2)}%</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 flex items-center gap-1"><Shield className="h-3.5 w-3.5" />リスク</td>
                      <td className="text-right py-2 px-2">{result.classical.portfolioRisk.toFixed(2)}%</td>
                      <td className="text-right py-2 px-2">{result.quantum.portfolioRisk.toFixed(2)}%</td>
                      <td className="text-right py-2 px-2 text-muted-foreground">{Math.abs(result.classical.portfolioRisk - result.quantum.portfolioRisk).toFixed(2)}%</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 flex items-center gap-1"><Percent className="h-3.5 w-3.5" />シャープ比</td>
                      <td className="text-right py-2 px-2">{result.classical.sharpeRatio.toFixed(3)}</td>
                      <td className="text-right py-2 px-2">{result.quantum.sharpeRatio.toFixed(3)}</td>
                      <td className="text-right py-2 px-2 text-muted-foreground">{Math.abs(result.classical.sharpeRatio - result.quantum.sharpeRatio).toFixed(3)}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 flex items-center gap-1"><Layers className="h-3.5 w-3.5" />分散スコア</td>
                      <td className="text-right py-2 px-2">{result.classical.diversificationScore.toFixed(1)}</td>
                      <td className="text-right py-2 px-2">{result.quantum.diversificationScore.toFixed(1)}</td>
                      <td className="text-right py-2 px-2 text-muted-foreground">{Math.abs(result.classical.diversificationScore - result.quantum.diversificationScore).toFixed(1)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2">選択銘柄数</td>
                      <td className="text-right py-2 px-2">{result.classical.selectedAssets.length}</td>
                      <td className="text-right py-2 px-2">{result.quantum.selectedAssets.length}</td>
                      <td className="text-right py-2 px-2 text-muted-foreground">{Math.abs(result.classical.selectedAssets.length - result.quantum.selectedAssets.length)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-muted/30 rounded-md p-3 mt-4 text-xs text-muted-foreground">
                {result.classical.sharpeRatio > result.quantum.sharpeRatio
                  ? "古典的手法の方がシャープ比が高く、リスク調整後リターンが優れています。"
                  : result.quantum.sharpeRatio > result.classical.sharpeRatio
                  ? "QAOA量子最適化の方がシャープ比が高く、リスク調整後リターンが優れています。"
                  : "両手法のシャープ比は同等です。"
                }
                {result.quantum.diversificationScore > result.classical.diversificationScore + 5
                  ? " QAOAはより分散されたポートフォリオを選択しています。"
                  : result.classical.diversificationScore > result.quantum.diversificationScore + 5
                  ? " 古典的手法はより分散されたポートフォリオを選択しています。"
                  : ""
                }
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-candidates">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">候補銘柄一覧</CardTitle>
              <p className="text-xs text-muted-foreground">買いシグナルが検出された上位{result.candidates.length}銘柄</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {result.candidates.map((c, i) => {
                  const inClassical = result.classical.selectedAssets.some(a => a.ticker === c.ticker);
                  const inQuantum = result.quantum.selectedAssets.some(a => a.ticker === c.ticker);
                  return (
                    <div key={c.ticker} className="flex items-center gap-2 py-1.5 px-2 bg-muted/20 rounded text-sm" data-testid={`candidate-${c.ticker}`}>
                      <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                      <span className="font-mono text-xs w-12">{c.ticker}</span>
                      <span className="flex-1 truncate text-xs">{c.name}</span>
                      <SignalBadge signal={c.signal} />
                      <span className="text-xs text-muted-foreground w-16 text-right">RSI {c.rsiValue?.toFixed(0) ?? "-"}</span>
                      <span className="text-xs w-16 text-right">{formatJPY(c.currentPrice)}</span>
                      <span className={`text-xs w-16 text-right ${c.expectedReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {c.expectedReturn >= 0 ? "+" : ""}{c.expectedReturn.toFixed(1)}%
                      </span>
                      <div className="flex gap-0.5">
                        {inClassical && <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-400 text-blue-600 dark:text-blue-400">古典</Badge>}
                        {inQuantum && <Badge variant="outline" className="text-[10px] px-1 py-0 border-purple-400 text-purple-600 dark:text-purple-400">QAOA</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {result.qaoaDetails && (
            <Card data-testid="card-qaoa-details">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Atom className="h-5 w-5" />
                  QAOA量子回路詳細
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-center text-sm">
                  <div className="p-2 bg-muted/30 rounded">
                    <p className="text-xs text-muted-foreground">量子ビット数</p>
                    <p className="font-bold">{result.qaoaDetails.nAssets}</p>
                  </div>
                  <div className="p-2 bg-muted/30 rounded">
                    <p className="text-xs text-muted-foreground">QAOAレイヤー</p>
                    <p className="font-bold">{result.qaoaDetails.nLayers}</p>
                  </div>
                  <div className="p-2 bg-muted/30 rounded">
                    <p className="text-xs text-muted-foreground">手法</p>
                    <p className="font-bold text-xs">{result.qaoaDetails.qaoaMethod}</p>
                  </div>
                </div>

                {result.qaoaDetails.topSolutions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2">上位量子解（確率順）</p>
                    <div className="space-y-1">
                      {result.qaoaDetails.topSolutions.slice(0, 5).map((sol, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs py-1 px-2 bg-muted/20 rounded">
                          <span className="text-muted-foreground">#{i + 1}</span>
                          <span className="font-mono flex-1">
                            [{sol.selection.map((s, j) => (
                              <span key={j} className={s === 1 ? "text-purple-600 dark:text-purple-400 font-bold" : "text-muted-foreground"}>
                                {s}{j < sol.selection.length - 1 ? "," : ""}
                              </span>
                            ))}]
                          </span>
                          <span className="text-muted-foreground">確率: {(sol.probability * 100).toFixed(1)}%</span>
                          <span className="text-muted-foreground">コスト: {sol.cost.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Atom className="h-4 w-4" />手法の説明
            </h3>
            <div className="grid gap-3 md:grid-cols-2 text-xs text-muted-foreground">
              <div>
                <p className="font-medium text-foreground mb-1">古典的マーコウィッツ最適化</p>
                <p>
                  期待リターンと共分散行列からリスク調整済みスコアを計算し、上位銘柄にスコア比例で配分します。
                  標準的な平均分散最適化理論に基づいており、計算は高速です。
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">QAOA量子近似最適化</p>
                <p>
                  ポートフォリオ選択問題をQUBO（二次制約なし二値最適化）に変換し、PennyLaneのQAOA回路で解きます。
                  各銘柄を1量子ビットに対応させ、コストハミルトニアンとミキサーハミルトニアンを交互に適用して最適な組み合わせを探索します。
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
