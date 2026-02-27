import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AlertTriangle, Shield, ShieldAlert, ShieldCheck, ShieldX,
  Activity, BarChart3, Brain, Cpu, RefreshCw, TrendingDown,
  Gauge, Zap, Atom
} from "lucide-react";

interface ClassicalResult {
  riskScore: number;
  riskLevel: string;
  volatilityScore: number;
  volumeScore: number;
  breadthScore: number;
  rsiScore: number;
  correlationScore: number;
  details: {
    totalStocks: number;
    sellSignalRatio: number;
    strongSellCount: number;
    avgRsi: number;
    lowRsiCount: number;
    highVolatilityCount: number;
    maDeathCrossRatio: number;
    bbBreakdownCount: number;
    warnings: string[];
  };
}

interface QmlResult {
  riskScore: number;
  riskLevel: string;
  features: {
    volatility: number;
    volumeRatio: number;
    breadth: number;
    rsiSeverity: number;
    macdSellRatio: number;
  };
  quantumExpectations: number[];
  nQubits: number;
  nLayers: number;
  error?: string;
}

interface RiskHistory {
  id: string;
  method: string;
  riskScore: number;
  riskLevel: string;
  calculatedAt: string;
}

function riskLevelLabel(level: string): string {
  switch (level) {
    case "danger": return "危険";
    case "warning": return "警戒";
    case "caution": return "注意";
    default: return "正常";
  }
}

function riskLevelColor(level: string): string {
  switch (level) {
    case "danger": return "text-red-600 dark:text-red-400";
    case "warning": return "text-orange-600 dark:text-orange-400";
    case "caution": return "text-yellow-600 dark:text-yellow-400";
    default: return "text-emerald-600 dark:text-emerald-400";
  }
}

function riskBadgeVariant(level: string): "default" | "secondary" | "destructive" | "outline" {
  switch (level) {
    case "danger": return "destructive";
    case "warning": return "default";
    default: return "secondary";
  }
}

function RiskIcon({ level, className }: { level: string; className?: string }) {
  switch (level) {
    case "danger": return <ShieldX className={className} />;
    case "warning": return <ShieldAlert className={className} />;
    case "caution": return <AlertTriangle className={className} />;
    default: return <ShieldCheck className={className} />;
  }
}

function RiskGauge({ score, label, size = "lg" }: { score: number; label: string; size?: "lg" | "sm" }) {
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#dc2626" : score >= 60 ? "#ea580c" : score >= 40 ? "#ca8a04" : "#16a34a";

  if (size === "sm") {
    const smCirc = 2 * Math.PI * 20;
    const smOffset = smCirc - (score / 100) * smCirc;
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="relative w-12 h-12">
          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
            <circle cx="25" cy="25" r="20" fill="none" stroke={color} strokeWidth="4"
              strokeDasharray={smCirc} strokeDashoffset={smOffset} strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{Math.round(score)}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-32">
        <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/30" />
          <circle cx="50" cy="50" r="45" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-1000" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold">{Math.round(score)}</span>
          <span className="text-xs text-muted-foreground">/100</span>
        </div>
      </div>
    </div>
  );
}

function SubScoreBar({ label, score, icon: Icon }: { label: string; score: number; icon: any }) {
  const color = score >= 80 ? "bg-red-500" : score >= 60 ? "bg-orange-500" : score >= 40 ? "bg-yellow-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{label}</span>
        </div>
        <span className="font-medium">{Math.round(score)}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
    </div>
  );
}

export default function RiskAlert() {
  const { toast } = useToast();
  const [assessResult, setAssessResult] = useState<{ classical?: ClassicalResult; qml?: QmlResult } | null>(null);

  const { data: preview, isLoading: previewLoading } = useQuery<{ classical: ClassicalResult; qml: QmlResult }>({
    queryKey: ["/api/risk/preview"],
  });

  const { data: history } = useQuery<RiskHistory[]>({
    queryKey: ["/api/risk/history"],
  });

  const assessMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/risk/assess", { method: "both" });
      return res.json();
    },
    onSuccess: (data) => {
      setAssessResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/risk/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/risk/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/risk/latest"] });
      toast({ title: "リスク評価完了", description: "古典的手法とQMLの両方で評価しました" });
    },
    onError: (err: any) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const classical = assessResult?.classical || (preview?.classical as ClassicalResult | undefined);
  const qml = assessResult?.qml || (preview?.qml as QmlResult | undefined);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-risk-alert">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">市場リスクアラート</h1>
          <p className="text-sm text-muted-foreground mt-1">古典的異常検知とQML（量子機械学習）による暴落危険度の比較分析</p>
        </div>
        <Button
          onClick={() => assessMutation.mutate()}
          disabled={assessMutation.isPending}
          data-testid="button-run-assessment"
        >
          {assessMutation.isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />分析中...</>
          ) : (
            <><Activity className="h-4 w-4 mr-2" />リスク評価実行</>
          )}
        </Button>
      </div>

      {previewLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card data-testid="card-classical-risk">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BarChart3 className="h-5 w-5" />
                  古典的異常検知
                </CardTitle>
                {classical && (
                  <Badge variant={riskBadgeVariant(classical.riskLevel)} data-testid="badge-classical-level">
                    {riskLevelLabel(classical.riskLevel)}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                ボラティリティ・出来高・RSI・移動平均・ボリンジャーバンドの統計的分析
              </p>
            </CardHeader>
            <CardContent>
              {classical ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <RiskGauge score={classical.riskScore} label="リスクスコア" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <RiskIcon level={classical.riskLevel} className={`h-6 w-6 ${riskLevelColor(classical.riskLevel)}`} />
                        <span className={`text-xl font-bold ${riskLevelColor(classical.riskLevel)}`}>
                          {riskLevelLabel(classical.riskLevel)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        分析対象: {classical.details?.totalStocks ?? 0}銘柄
                      </p>
                      <p className="text-xs text-muted-foreground">
                        平均RSI: {classical.details?.avgRsi?.toFixed(1) ?? "-"}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <SubScoreBar label="ボラティリティ" score={classical.volatilityScore} icon={Activity} />
                    <SubScoreBar label="MACD売り圧力" score={classical.volumeScore} icon={TrendingDown} />
                    <SubScoreBar label="市場全体シグナル" score={classical.breadthScore} icon={BarChart3} />
                    <SubScoreBar label="RSI過売り度" score={classical.rsiScore} icon={Gauge} />
                    <SubScoreBar label="BB・強売り集中" score={classical.correlationScore} icon={Zap} />
                  </div>

                  {classical.details?.warnings && classical.details.warnings.length > 0 && (
                    <div className="bg-destructive/10 rounded-md p-3 space-y-1">
                      <p className="text-xs font-medium text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" />警告
                      </p>
                      {classical.details.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-destructive/80">• {w}</p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">「リスク評価実行」を押して分析を開始してください</p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-qml-risk">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Atom className="h-5 w-5" />
                  QML（量子機械学習）
                </CardTitle>
                {qml && !qml.error && (
                  <Badge variant={riskBadgeVariant(qml.riskLevel)} data-testid="badge-qml-level">
                    {riskLevelLabel(qml.riskLevel)}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                PennyLane変分量子回路による異常検知（{qml?.nQubits || 5}量子ビット・{qml?.nLayers || 3}レイヤー）
              </p>
            </CardHeader>
            <CardContent>
              {qml ? (
                qml.error ? (
                  <div className="text-center py-8">
                    <ShieldX className="h-8 w-8 mx-auto mb-2 text-destructive" />
                    <p className="text-sm text-destructive font-medium">QMLエラー</p>
                    <p className="text-xs text-muted-foreground mt-1">{qml.error}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <RiskGauge score={qml.riskScore} label="リスクスコア" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <RiskIcon level={qml.riskLevel} className={`h-6 w-6 ${riskLevelColor(qml.riskLevel)}`} />
                          <span className={`text-xl font-bold ${riskLevelColor(qml.riskLevel)}`}>
                            {riskLevelLabel(qml.riskLevel)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          量子ビット: {qml.nQubits} / レイヤー: {qml.nLayers}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">量子特徴エンコーディング</p>
                      <div className="grid grid-cols-5 gap-2">
                        <RiskGauge score={qml.features.volatility * 100} label="変動率" size="sm" />
                        <RiskGauge score={qml.features.volumeRatio * 100} label="出来高比" size="sm" />
                        <RiskGauge score={qml.features.breadth * 100} label="売り幅" size="sm" />
                        <RiskGauge score={qml.features.rsiSeverity * 100} label="RSI深度" size="sm" />
                        <RiskGauge score={qml.features.macdSellRatio * 100} label="MACD売" size="sm" />
                      </div>
                    </div>

                    {qml.quantumExpectations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">量子ビット期待値 ⟨Z⟩</p>
                        <div className="flex gap-2">
                          {qml.quantumExpectations.map((val, i) => (
                            <div key={i} className="flex-1 text-center">
                              <div className="text-xs font-mono bg-muted rounded px-1 py-0.5">
                                q{i}: {val.toFixed(3)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">「リスク評価実行」を押して分析を開始してください</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card data-testid="card-comparison">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5" />
            手法比較
          </CardTitle>
        </CardHeader>
        <CardContent>
          {classical && qml && !qml.error ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">古典的手法</p>
                  <p className={`text-2xl font-bold ${riskLevelColor(classical.riskLevel)}`}>{classical.riskScore}</p>
                  <Badge variant={riskBadgeVariant(classical.riskLevel)} className="mt-1">{riskLevelLabel(classical.riskLevel)}</Badge>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <p className="text-xs text-muted-foreground mb-1">差分</p>
                  <p className="text-2xl font-bold">
                    {Math.abs(classical.riskScore - qml.riskScore).toFixed(1)}
                  </p>
                  <p className="text-xs text-muted-foreground">ポイント差</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">QML</p>
                  <p className={`text-2xl font-bold ${riskLevelColor(qml.riskLevel)}`}>{qml.riskScore}</p>
                  <Badge variant={riskBadgeVariant(qml.riskLevel)} className="mt-1">{riskLevelLabel(qml.riskLevel)}</Badge>
                </div>
              </div>

              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-xs text-muted-foreground">
                  {classical.riskLevel === qml.riskLevel
                    ? "両手法のリスク判定が一致しています。判定の信頼性が高いと考えられます。"
                    : `リスク判定に相違があります（古典: ${riskLevelLabel(classical.riskLevel)} / QML: ${riskLevelLabel(qml.riskLevel)}）。より慎重な判定を採用することを推奨します。`
                  }
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              両方の手法でリスク評価を実行すると、ここで比較結果が表示されます
            </p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-history">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">評価履歴</CardTitle>
        </CardHeader>
        <CardContent>
          {history && history.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded" data-testid={`row-history-${h.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {h.method === "qml" ? "QML" : "古典"}
                    </Badge>
                    <RiskIcon level={h.riskLevel} className={`h-4 w-4 ${riskLevelColor(h.riskLevel)}`} />
                    <span className={`text-sm font-medium ${riskLevelColor(h.riskLevel)}`}>
                      {riskLevelLabel(h.riskLevel)}
                    </span>
                    <span className="text-sm font-mono">{h.riskScore}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(h.calculatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">まだ評価履歴がありません</p>
          )}
        </CardContent>
      </Card>

      <div className="bg-muted/30 rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Cpu className="h-4 w-4" />手法の説明
        </h3>
        <div className="grid gap-3 md:grid-cols-2 text-xs text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-1">古典的異常検知</p>
            <p>統計的手法でボラティリティ急上昇、出来高異常、RSI過売り集中、移動平均デッドクロス率、ボリンジャーバンド下限割れ率を計算し、重み付け合成スコアで市場全体のリスクを評価します。</p>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">QML（量子機械学習）</p>
            <p>PennyLaneの変分量子回路シミュレーターを使用。市場特徴量を{qml?.nQubits || 5}量子ビットに角度エンコーディングし、パラメータ化された回転ゲートとCNOTエンタングルメントで異常パターンを検出します。古典コンピュータ上のシミュレーションです。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
