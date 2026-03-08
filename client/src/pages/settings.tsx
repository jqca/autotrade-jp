import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings, Save, Coins, Clock, TrendingUp, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

interface AppSetting {
  key: string;
  value: string;
  label: string;
  description: string | null;
  updatedAt: string | null;
}

const HOUR_OPTIONS = [9, 10, 11, 12, 13, 14, 15];
const END_HOUR_OPTIONS = [9, 10, 11, 12, 13, 14, 15, 16];
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export default function SettingsPage() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<AppSetting[]>({
    queryKey: ["/api/settings"],
  });

  const [editValues, setEditValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      const values: Record<string, string> = {};
      settings.forEach((s) => {
        values[s.key] = s.value;
      });
      setEditValues(values);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async ({ key, value, label, description }: { key: string; value: string; label: string; description?: string }) => {
      const res = await apiRequest("PUT", `/api/settings/${key}`, { value, label, description });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "保存しました", description: "設定が更新されました" });
    },
    onError: (error: Error) => {
      toast({ title: "エラー", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = (setting: AppSetting) => {
    const newValue = editValues[setting.key];
    if (newValue === undefined) return;

    if (setting.key === "initial_credits") {
      const num = parseInt(newValue, 10);
      if (isNaN(num) || num < 0 || num > 10000) {
        toast({ title: "エラー", description: "0〜10,000の範囲で入力してください", variant: "destructive" });
        return;
      }
    }

    if (setting.key === "trading_start_hour" || setting.key === "trading_end_hour") {
      const num = parseInt(newValue, 10);
      if (isNaN(num) || num < 0 || num > 23) {
        toast({ title: "エラー", description: "0〜23の範囲で入力してください", variant: "destructive" });
        return;
      }
    }

    updateMutation.mutate({
      key: setting.key,
      value: newValue,
      label: setting.label,
      description: setting.description || undefined,
    });
  };

  const handleSaveMultiple = (keys: { key: string; value: string; label: string; description?: string }[]) => {
    keys.forEach((k) => updateMutation.mutate(k));
  };

  const getSettingIcon = (key: string) => {
    if (key === "initial_credits") return <Coins className="h-5 w-5 text-yellow-500" />;
    if (key.startsWith("trading_")) return <Clock className="h-5 w-5 text-blue-500" />;
    return <Settings className="h-5 w-5" />;
  };

  const tradingStartHour = parseInt(editValues["trading_start_hour"] || "9", 10);
  const tradingStartMinute = parseInt(editValues["trading_start_minute"] || "30", 10);
  const tradingEndHour = parseInt(editValues["trading_end_hour"] || "10", 10);
  const tradingEndMinute = parseInt(editValues["trading_end_minute"] || "30", 10);
  const nikkeiMomentumEnabled = editValues["require_nikkei_momentum"] === "true";
  const nikkeiMomentumBars = parseInt(editValues["nikkei_momentum_bars"] || "6", 10);

  const excludePriceEnabled = editValues["exclude_price_enabled"] === "true";
  const excludePriceMin = parseInt(editValues["exclude_price_min"] || "0", 10);
  const excludePriceMax = parseInt(editValues["exclude_price_max"] || "1000", 10);
  const rsiExcludeEnabled = editValues["rsi_exclude_enabled"] === "true";
  const rsiExcludeMinVal = parseInt(editValues["rsi_exclude_min"] || "50", 10);
  const rsiExcludeMaxVal = parseInt(editValues["rsi_exclude_max"] || "60", 10);

  const generalSettings = (settings || []).filter(s => !s.key.startsWith("trading_") && !s.key.startsWith("nikkei_") && !s.key.startsWith("exclude_price") && !s.key.startsWith("rsi_exclude") && s.key !== "require_nikkei_momentum");
  const hasTradingSettings = (settings || []).some(s => s.key.startsWith("trading_"));

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-settings-title">設定</h1>
        <p className="text-muted-foreground">アプリケーション全体の設定を管理します</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <Card data-testid="card-setting-trading-hours">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-5 w-5 text-blue-500" />
                取引時間帯
              </CardTitle>
              <CardDescription>
                日中足バックテスト・自動売買でエントリーする時間帯を設定します。9:30〜10:00が最も勝率が高い結果が出ています。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-4">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-sm text-muted-foreground">取引開始時刻</Label>
                  <div className="flex gap-1">
                    <select
                      value={tradingStartHour}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, trading_start_hour: e.target.value }))}
                      className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                      data-testid="select-setting-trading-start-hour"
                    >
                      {HOUR_OPTIONS.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="pt-2 text-muted-foreground">:</span>
                    <select
                      value={tradingStartMinute}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, trading_start_minute: e.target.value }))}
                      className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                      data-testid="select-setting-trading-start-minute"
                    >
                      {MINUTE_OPTIONS.map(m => (
                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <span className="text-muted-foreground pb-2">〜</span>
                <div className="flex-1 space-y-1.5">
                  <Label className="text-sm text-muted-foreground">取引終了時刻</Label>
                  <div className="flex gap-1">
                    <select
                      value={tradingEndHour}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, trading_end_hour: e.target.value }))}
                      className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                      data-testid="select-setting-trading-end-hour"
                    >
                      {END_HOUR_OPTIONS.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="pt-2 text-muted-foreground">:</span>
                    <select
                      value={tradingEndMinute}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, trading_end_minute: e.target.value }))}
                      className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                      data-testid="select-setting-trading-end-minute"
                    >
                      {MINUTE_OPTIONS.map(m => (
                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  現在の設定: <span className="font-medium text-foreground">{tradingStartHour}:{String(tradingStartMinute).padStart(2, '0')} 〜 {tradingEndHour}:{String(tradingEndMinute).padStart(2, '0')}</span>
                </p>
                <Button
                  onClick={() => handleSaveMultiple([
                    { key: "trading_start_hour", value: String(tradingStartHour), label: "取引開始時刻（時）", description: "日中足でエントリーする開始時刻（時、0-23）" },
                    { key: "trading_start_minute", value: String(tradingStartMinute), label: "取引開始時刻（分）", description: "日中足でエントリーする開始時刻（分、0-55）" },
                    { key: "trading_end_hour", value: String(tradingEndHour), label: "取引終了時刻（時）", description: "日中足でエントリーする終了時刻（時、0-24）" },
                    { key: "trading_end_minute", value: String(tradingEndMinute), label: "取引終了時刻（分）", description: "日中足でエントリーする終了時刻（分、0-55）" },
                  ])}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-trading-hours"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  保存
                </Button>
              </div>
              {hasTradingSettings && (
                <p className="text-xs text-muted-foreground">
                  最終更新: {new Date((settings || []).find(s => s.key === "trading_start_hour")?.updatedAt || "").toLocaleString("ja-JP")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-setting-filters">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="h-5 w-5 text-green-500" />
                エントリーフィルター
              </CardTitle>
              <CardDescription>
                勝率を上げるために、弱い条件の銘柄をバックテスト対象から除外します。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">株価除外帯</Label>
                  <Switch
                    checked={excludePriceEnabled}
                    onCheckedChange={(v) => setEditValues((prev) => ({ ...prev, exclude_price_enabled: v ? "true" : "false" }))}
                    data-testid="switch-setting-exclude-price"
                  />
                </div>
                {excludePriceEnabled && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <span className="text-xs text-muted-foreground">下限（円）</span>
                      <Input
                        type="number"
                        value={excludePriceMin}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, exclude_price_min: e.target.value }))}
                        data-testid="input-setting-exclude-price-min"
                      />
                    </div>
                    <span className="mt-5 text-sm text-muted-foreground">〜</span>
                    <div className="flex-1 space-y-1">
                      <span className="text-xs text-muted-foreground">上限（円）</span>
                      <Input
                        type="number"
                        value={excludePriceMax}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, exclude_price_max: e.target.value }))}
                        data-testid="input-setting-exclude-price-max"
                      />
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">1000円未満は勝率44%と低いため除外推奨</p>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">RSI除外帯</Label>
                  <Switch
                    checked={rsiExcludeEnabled}
                    onCheckedChange={(v) => setEditValues((prev) => ({ ...prev, rsi_exclude_enabled: v ? "true" : "false" }))}
                    data-testid="switch-setting-rsi-exclude"
                  />
                </div>
                {rsiExcludeEnabled && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <span className="text-xs text-muted-foreground">下限</span>
                      <Input
                        type="number"
                        value={rsiExcludeMinVal}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, rsi_exclude_min: e.target.value }))}
                        data-testid="input-setting-rsi-exclude-min"
                      />
                    </div>
                    <span className="mt-5 text-sm text-muted-foreground">〜</span>
                    <div className="flex-1 space-y-1">
                      <span className="text-xs text-muted-foreground">上限</span>
                      <Input
                        type="number"
                        value={rsiExcludeMaxVal}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, rsi_exclude_max: e.target.value }))}
                        data-testid="input-setting-rsi-exclude-max"
                      />
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">RSI 50〜60は勝率47.9%と低いため除外推奨</p>
              </div>

              <div className="flex items-center justify-end">
                <Button
                  onClick={() => handleSaveMultiple([
                    { key: "exclude_price_enabled", value: excludePriceEnabled ? "true" : "false", label: "株価除外フィルター", description: "指定株価帯を除外" },
                    { key: "exclude_price_min", value: String(excludePriceMin), label: "株価除外下限", description: "除外する株価の下限（円）" },
                    { key: "exclude_price_max", value: String(excludePriceMax), label: "株価除外上限", description: "除外する株価の上限（円）" },
                    { key: "rsi_exclude_enabled", value: rsiExcludeEnabled ? "true" : "false", label: "RSI除外フィルター", description: "指定RSI帯を除外" },
                    { key: "rsi_exclude_min", value: String(rsiExcludeMinVal), label: "RSI除外下限", description: "除外するRSIの下限" },
                    { key: "rsi_exclude_max", value: String(rsiExcludeMaxVal), label: "RSI除外上限", description: "除外するRSIの上限" },
                  ])}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-filters"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-setting-nikkei-momentum">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-orange-500" />
                日経平均モメンタムフィルター
              </CardTitle>
              <CardDescription>
                日経平均の勢い（直近N本の上昇/下落）を判定し、上昇中のみエントリーするフィルターです。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm">フィルターを有効にする</Label>
                <Switch
                  checked={nikkeiMomentumEnabled}
                  onCheckedChange={(v) => setEditValues((prev) => ({ ...prev, require_nikkei_momentum: v ? "true" : "false" }))}
                  data-testid="switch-setting-nikkei-momentum"
                />
              </div>
              {nikkeiMomentumEnabled && (
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">参照バー数: {nikkeiMomentumBars}本</Label>
                  <input
                    type="range"
                    min={2}
                    max={20}
                    value={nikkeiMomentumBars}
                    onChange={(e) => setEditValues((prev) => ({ ...prev, nikkei_momentum_bars: e.target.value }))}
                    className="w-full"
                    data-testid="input-setting-nikkei-momentum-bars"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>2本（短期）</span>
                    <span>20本（長期）</span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end">
                <Button
                  onClick={() => handleSaveMultiple([
                    { key: "require_nikkei_momentum", value: nikkeiMomentumEnabled ? "true" : "false", label: "日経モメンタムフィルター", description: "日経平均上昇中のみエントリーする" },
                    { key: "nikkei_momentum_bars", value: String(nikkeiMomentumBars), label: "モメンタム参照バー数", description: "日経平均モメンタム判定に使う5分足バー数" },
                  ])}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-nikkei-momentum"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>

          <Separator />

          {generalSettings.map((setting) => (
            <Card key={setting.key} data-testid={`card-setting-${setting.key}`}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {getSettingIcon(setting.key)}
                  {setting.label}
                </CardTitle>
                {setting.description && (
                  <CardDescription>{setting.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Label htmlFor={`setting-${setting.key}`} className="text-sm text-muted-foreground mb-1 block">
                      {setting.key === "initial_credits" ? "クレジット数（0〜10,000）" : "値"}
                    </Label>
                    <Input
                      id={`setting-${setting.key}`}
                      type={setting.key === "initial_credits" ? "number" : "text"}
                      min={setting.key === "initial_credits" ? 0 : undefined}
                      max={setting.key === "initial_credits" ? 10000 : undefined}
                      value={editValues[setting.key] ?? setting.value}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [setting.key]: e.target.value }))}
                      data-testid={`input-setting-${setting.key}`}
                    />
                  </div>
                  <Button
                    onClick={() => handleSave(setting)}
                    disabled={updateMutation.isPending || editValues[setting.key] === setting.value}
                    data-testid={`button-save-${setting.key}`}
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    保存
                  </Button>
                </div>
                {setting.updatedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    最終更新: {new Date(setting.updatedAt).toLocaleString("ja-JP")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}

          {(!settings || settings.length === 0) && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                設定項目がありません
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
