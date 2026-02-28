import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Settings, Save, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

interface AppSetting {
  key: string;
  value: string;
  label: string;
  description: string | null;
  updatedAt: string | null;
}

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

    updateMutation.mutate({
      key: setting.key,
      value: newValue,
      label: setting.label,
      description: setting.description || undefined,
    });
  };

  const getSettingIcon = (key: string) => {
    if (key === "initial_credits") return <Coins className="h-5 w-5 text-yellow-500" />;
    return <Settings className="h-5 w-5" />;
  };

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
        <div className="space-y-4">
          {(settings || []).map((setting) => (
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
