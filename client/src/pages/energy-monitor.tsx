import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Zap, Cpu, Snowflake, Leaf, Trash2, Activity, BarChart3, Clock, AlertTriangle } from "lucide-react";
import { useState } from "react";

interface EnergyLog {
  id: string;
  taskType: string;
  taskName: string;
  processor: string;
  durationMs: number;
  powerWatts: number;
  energyWh: number;
  co2Grams: number;
  details: string | null;
  recordedAt: string | null;
}

interface EnergySummary {
  totalAiWh: number;
  totalQuantumWh: number;
  totalCo2: number;
  count: number;
  byProcessor: Record<string, { totalWh: number; totalCo2: number; count: number; totalMs: number }>;
  byTask: Record<string, { totalWh: number; totalCo2: number; count: number; totalMs: number }>;
  timeline: { date: string; aiWh: number; quantumWh: number }[];
  profiles: Record<string, { idle: number; load: number; description: string }>;
}

function formatWh(wh: number): string {
  if (wh === 0) return "0 Wh";
  if (wh < 0.001) return `${(wh * 1000000).toFixed(2)} μWh`;
  if (wh < 1) return `${(wh * 1000).toFixed(2)} mWh`;
  if (wh < 1000) return `${wh.toFixed(4)} Wh`;
  return `${(wh / 1000).toFixed(4)} kWh`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`;
  return `${(ms / 60000).toFixed(1)}分`;
}

function formatCo2(g: number): string {
  if (g === 0) return "0 g";
  if (g < 0.001) return `${(g * 1000000).toFixed(2)} μg`;
  if (g < 1) return `${(g * 1000).toFixed(2)} mg`;
  return `${g.toFixed(4)} g`;
}

function ProcessorIcon({ processor }: { processor: string }) {
  if (processor === "CPU" || processor === "GPU") {
    return <Cpu className="h-4 w-4 text-blue-500" />;
  }
  if (processor.includes("QPU")) {
    return <Snowflake className="h-4 w-4 text-purple-500" />;
  }
  return <Zap className="h-4 w-4" />;
}

function ProcessorBadge({ processor }: { processor: string }) {
  const variant = processor === "CPU" || processor === "GPU" ? "default" : "secondary";
  const color = processor === "CPU" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    : processor === "GPU" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
  return (
    <Badge className={`${color} text-xs`} data-testid={`badge-processor-${processor}`}>
      <ProcessorIcon processor={processor} />
      <span className="ml-1">{processor}</span>
    </Badge>
  );
}

function EnergyBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{formatWh(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function EnergyMonitor() {
  const { toast } = useToast();
  const [simDuration, setSimDuration] = useState(60000);

  const { data: summary, isLoading: summaryLoading } = useQuery<EnergySummary>({
    queryKey: ["/api/energy/summary"],
    refetchInterval: 10000,
  });

  const { data: logs, isLoading: logsLoading } = useQuery<EnergyLog[]>({
    queryKey: ["/api/energy/logs"],
    refetchInterval: 10000,
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/energy/logs"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/energy/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/energy/summary"] });
      toast({ title: "消費電力ログを全削除しました" });
    },
  });

  const compareMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/energy/compare", { durationMs: simDuration }),
    onSuccess: async (res) => {
      const data = await res.json();
      setCompareResult(data);
    },
  });

  const [compareResult, setCompareResult] = useState<any>(null);

  const totalMax = Math.max(summary?.totalAiWh || 0, summary?.totalQuantumWh || 0, 0.0001);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Zap className="h-6 w-6 text-yellow-500" />
            消費電力モニター
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI (CPU/GPU) と量子コンピュータ (QPU+冷凍機) の計算処理に伴う消費電力量を監視
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending || !logs?.length}
          data-testid="button-clear-logs"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          ログ全削除
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-total-computations">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Activity className="h-4 w-4" />
              総計算回数
            </div>
            <div className="text-2xl font-bold">{summary?.count || 0}</div>
            <div className="text-xs text-muted-foreground">回の計算処理を記録</div>
          </CardContent>
        </Card>

        <Card data-testid="card-ai-energy">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 mb-1">
              <Cpu className="h-4 w-4" />
              AI消費電力（CPU/GPU）
            </div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatWh(summary?.totalAiWh || 0)}</div>
            <div className="text-xs text-muted-foreground">古典コンピュータ</div>
          </CardContent>
        </Card>

        <Card data-testid="card-quantum-energy">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 mb-1">
              <Snowflake className="h-4 w-4" />
              量子消費電力（QPU+冷凍機）
            </div>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{formatWh(summary?.totalQuantumWh || 0)}</div>
            <div className="text-xs text-muted-foreground">量子コンピュータ</div>
          </CardContent>
        </Card>

        <Card data-testid="card-co2">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 mb-1">
              <Leaf className="h-4 w-4" />
              CO₂排出量
            </div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCo2(summary?.totalCo2 || 0)}</div>
            <div className="text-xs text-muted-foreground">0.423 g/Wh (日本平均)</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList data-testid="tabs-energy">
          <TabsTrigger value="overview" data-testid="tab-overview">概要</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">ログ一覧</TabsTrigger>
          <TabsTrigger value="compare" data-testid="tab-compare">比較シミュレーション</TabsTrigger>
          <TabsTrigger value="profiles" data-testid="tab-profiles">電力プロファイル</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card data-testid="card-processor-breakdown">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  プロセッサ別消費電力
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary?.byProcessor && Object.keys(summary.byProcessor).length > 0 ? (
                  Object.entries(summary.byProcessor).map(([proc, data]) => (
                    <div key={proc} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <ProcessorBadge processor={proc} />
                        <span className="text-xs text-muted-foreground">{data.count}回</span>
                      </div>
                      <EnergyBar
                        label="電力量"
                        value={data.totalWh}
                        max={Math.max(...Object.values(summary.byProcessor).map(d => d.totalWh))}
                        color={proc === "CPU" || proc === "GPU" ? "bg-blue-500" : "bg-purple-500"}
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>合計処理時間: {formatMs(data.totalMs)}</span>
                        <span>CO₂: {formatCo2(data.totalCo2)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    まだデータがありません。ベンチマークやバックテストを実行すると記録されます。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-task-breakdown">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  タスク別消費電力
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary?.byTask && Object.keys(summary.byTask).length > 0 ? (
                  Object.entries(summary.byTask).map(([task, data]) => (
                    <div key={task} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{task === "benchmark" ? "ベンチマーク" : task === "backtest" ? "バックテスト" : task}</span>
                        <span className="text-xs text-muted-foreground">{data.count}回</span>
                      </div>
                      <EnergyBar
                        label="電力量"
                        value={data.totalWh}
                        max={Math.max(...Object.values(summary.byTask).map(d => d.totalWh))}
                        color="bg-amber-500"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>合計処理時間: {formatMs(data.totalMs)}</span>
                        <span>CO₂: {formatCo2(data.totalCo2)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    まだデータがありません。
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-energy-comparison">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4" />
                AI vs 量子 — 消費電力比較
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <EnergyBar label="AI (CPU/GPU)" value={summary?.totalAiWh || 0} max={totalMax} color="bg-blue-500" />
                <EnergyBar label="量子 (QPU+冷凍機)" value={summary?.totalQuantumWh || 0} max={totalMax} color="bg-purple-500" />

                <Separator />

                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    消費電力の特性
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">AI (CPU/GPU)</p>
                      <p>• CPU: アイドル15W → 負荷時65W</p>
                      <p>• GPU: アイドル30W → 負荷時250W</p>
                      <p>• 処理時間に比例して電力消費</p>
                      <p>• 小〜中規模の問題に効率的</p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">量子 (QPU+冷凍機)</p>
                      <p>• QPU: 0.01W → 0.025W（極めて低電力）</p>
                      <p>• 冷凍機: 15kW → 25kW（固定コスト大）</p>
                      <p>• 冷凍機の電力が支配的</p>
                      <p>• 大規模問題で高速化 → 省エネ効果</p>
                    </div>
                  </div>
                </div>

                {summary?.timeline && summary.timeline.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium mb-2">日別消費電力推移</h4>
                      <div className="space-y-2">
                        {summary.timeline.map((t) => (
                          <div key={t.date} className="flex items-center gap-3 text-xs">
                            <span className="w-24 font-mono text-muted-foreground">{t.date}</span>
                            <div className="flex-1 flex gap-2">
                              <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-blue-500" />
                                <span>AI: {formatWh(t.aiWh)}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-purple-500" />
                                <span>量子: {formatWh(t.quantumWh)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card data-testid="card-logs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">消費電力ログ（直近200件）</CardTitle>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="text-center py-8 text-muted-foreground">読み込み中...</div>
              ) : !logs?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  まだログがありません。ベンチマークやバックテストを実行すると自動的に記録されます。
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 px-2 font-medium text-muted-foreground">日時</th>
                        <th className="py-2 px-2 font-medium text-muted-foreground">タスク</th>
                        <th className="py-2 px-2 font-medium text-muted-foreground">処理内容</th>
                        <th className="py-2 px-2 font-medium text-muted-foreground">プロセッサ</th>
                        <th className="py-2 px-2 font-medium text-muted-foreground text-right">処理時間</th>
                        <th className="py-2 px-2 font-medium text-muted-foreground text-right">電力(W)</th>
                        <th className="py-2 px-2 font-medium text-muted-foreground text-right">電力量</th>
                        <th className="py-2 px-2 font-medium text-muted-foreground text-right">CO₂</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id} className="border-b hover:bg-muted/50" data-testid={`row-energy-${log.id}`}>
                          <td className="py-2 px-2 text-xs text-muted-foreground font-mono">
                            {log.recordedAt ? new Date(log.recordedAt).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}
                          </td>
                          <td className="py-2 px-2">
                            <Badge variant="outline" className="text-xs">
                              {log.taskType === "benchmark" ? "ベンチマーク" : log.taskType === "backtest" ? "バックテスト" : log.taskType}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-xs max-w-48 truncate">{log.taskName}</td>
                          <td className="py-2 px-2"><ProcessorBadge processor={log.processor} /></td>
                          <td className="py-2 px-2 text-right font-mono text-xs">{formatMs(log.durationMs)}</td>
                          <td className="py-2 px-2 text-right font-mono text-xs">{log.powerWatts.toFixed(1)}W</td>
                          <td className="py-2 px-2 text-right font-mono text-xs">{formatWh(log.energyWh)}</td>
                          <td className="py-2 px-2 text-right font-mono text-xs">{formatCo2(log.co2Grams)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compare" className="space-y-4">
          <Card data-testid="card-simulation">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                消費電力比較シミュレーション
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                同じ計算処理時間での各プロセッサの消費電力を比較します。量子コンピュータが問題を高速に解いた場合の省エネ効果も表示します。
              </p>

              <div className="flex items-center gap-4">
                <label className="text-sm font-medium">計算処理時間:</label>
                <div className="flex gap-2">
                  {[
                    { label: "1秒", ms: 1000 },
                    { label: "10秒", ms: 10000 },
                    { label: "1分", ms: 60000 },
                    { label: "10分", ms: 600000 },
                    { label: "1時間", ms: 3600000 },
                  ].map((opt) => (
                    <Button
                      key={opt.ms}
                      variant={simDuration === opt.ms ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSimDuration(opt.ms)}
                      data-testid={`button-sim-${opt.ms}`}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={() => compareMutation.mutate()}
                  disabled={compareMutation.isPending}
                  data-testid="button-run-compare"
                >
                  <Zap className="h-4 w-4 mr-1" />
                  比較実行
                </Button>
              </div>

              {compareResult && (
                <div className="space-y-4 mt-4">
                  <h4 className="text-sm font-medium">
                    計算時間 {formatMs(simDuration)} での消費電力比較
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {[
                      { label: "CPU", data: compareResult.cpu, color: "border-blue-500", textColor: "text-blue-600 dark:text-blue-400" },
                      { label: "GPU", data: compareResult.gpu, color: "border-green-500", textColor: "text-green-600 dark:text-green-400" },
                      { label: "QPU (単体)", data: compareResult.qpuOnly, color: "border-purple-300", textColor: "text-purple-400" },
                      { label: "QPU + 冷凍機", data: compareResult.qpuWithCryo, color: "border-purple-500", textColor: "text-purple-600 dark:text-purple-400" },
                    ].map((item) => (
                      <Card key={item.label} className={`border-l-4 ${item.color}`} data-testid={`card-compare-${item.label}`}>
                        <CardContent className="pt-3 pb-2 space-y-1">
                          <div className={`text-sm font-medium ${item.textColor}`}>{item.label}</div>
                          <div className="text-lg font-bold">{item.data.powerWatts.toFixed(1)} W</div>
                          <div className="text-xs text-muted-foreground">電力量: {formatWh(item.data.energyWh)}</div>
                          <div className="text-xs text-muted-foreground">CO₂: {formatCo2(item.data.co2Grams)}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <Separator />

                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Snowflake className="h-4 w-4 text-purple-500" />
                      量子高速化による省エネ効果
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      量子コンピュータが古典コンピュータより高速に問題を解ける場合、処理時間が短くなるため冷凍機の電力消費も減少し、トータルの消費電力が削減されます。
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border rounded-lg p-3 space-y-2">
                        <div className="text-sm font-medium">10倍高速化の場合</div>
                        <div className="text-xs text-muted-foreground">
                          量子計算時間: {formatMs(compareResult.speedupFactor.example10x.quantumDurationMs)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs">量子電力:</span>
                          <span className="font-mono text-xs">{formatWh(compareResult.speedupFactor.example10x.quantumEnergy.energyWh)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs">古典電力:</span>
                          <span className="font-mono text-xs">{formatWh(compareResult.speedupFactor.example10x.classicalEnergy.energyWh)}</span>
                        </div>
                        <Badge className={compareResult.speedupFactor.example10x.savingsPercent > 0 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}>
                          {compareResult.speedupFactor.example10x.savingsPercent > 0 ? "省エネ" : "増エネ"}: {Math.abs(compareResult.speedupFactor.example10x.savingsPercent)}%
                        </Badge>
                      </div>

                      <div className="border rounded-lg p-3 space-y-2">
                        <div className="text-sm font-medium">100倍高速化の場合</div>
                        <div className="text-xs text-muted-foreground">
                          量子計算時間: {formatMs(compareResult.speedupFactor.example100x.quantumDurationMs)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs">量子電力:</span>
                          <span className="font-mono text-xs">{formatWh(compareResult.speedupFactor.example100x.quantumEnergy.energyWh)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs">古典電力:</span>
                          <span className="font-mono text-xs">{formatWh(compareResult.speedupFactor.example100x.classicalEnergy.energyWh)}</span>
                        </div>
                        <Badge className={compareResult.speedupFactor.example100x.savingsPercent > 0 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}>
                          {compareResult.speedupFactor.example100x.savingsPercent > 0 ? "省エネ" : "増エネ"}: {Math.abs(compareResult.speedupFactor.example100x.savingsPercent)}%
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profiles" className="space-y-4">
          <Card data-testid="card-profiles">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                ハードウェア電力プロファイル
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                消費電力推定に使用している各ハードウェアの電力プロファイル（代表的な値）
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-blue-500" />
                    <h4 className="font-medium">CPU (古典計算)</h4>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">アイドル時</span>
                      <span className="font-mono">15 W</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">負荷時</span>
                      <span className="font-mono">65 W</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    GradientBoosting、RandomForest等の機械学習モデルの学習・推論に使用。処理時間に比例して電力を消費。
                  </p>
                </div>

                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-green-500" />
                    <h4 className="font-medium">GPU (ディープラーニング)</h4>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">アイドル時</span>
                      <span className="font-mono">30 W</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">負荷時</span>
                      <span className="font-mono">250 W</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    並列計算に特化。ディープラーニング等の大量行列演算を高速化。CPUの数倍の電力を消費。
                  </p>
                </div>

                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-purple-400" />
                    <h4 className="font-medium">QPU (量子処理装置)</h4>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">アイドル時</span>
                      <span className="font-mono">0.01 W</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">負荷時</span>
                      <span className="font-mono">0.025 W</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    量子ゲート操作を行うチップ。消費電力は極めて小さいが、単体では動作不可（冷凍機が必要）。
                  </p>
                </div>

                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Snowflake className="h-5 w-5 text-purple-500" />
                    <h4 className="font-medium">冷凍機 (希釈冷凍機)</h4>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">アイドル時</span>
                      <span className="font-mono">15,000 W</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">負荷時</span>
                      <span className="font-mono">25,000 W</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    超伝導量子ビットを15mK（-273.135℃）まで冷却する装置。量子コンピュータの最大電力消費源。計算の有無に関わらず常時稼働が必要。
                  </p>
                </div>
              </div>

              <Separator className="my-4" />

              <div className="bg-muted/50 rounded-lg p-4">
                <h4 className="text-sm font-medium mb-2">消費電力計算式</h4>
                <div className="space-y-1 text-xs text-muted-foreground font-mono">
                  <p>電力 (W) = アイドル + (負荷 - アイドル) × 負荷率</p>
                  <p>電力量 (Wh) = 電力 (W) × 処理時間 (h)</p>
                  <p>CO₂排出量 (g) = 電力量 (Wh) × 0.423 g/Wh</p>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  ※ CO₂排出係数は日本の電力会社平均値（2024年度）を使用
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
