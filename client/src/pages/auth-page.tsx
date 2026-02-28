import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Zap, LogIn, UserPlus, Loader2 } from "lucide-react";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { login, register, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      toast({ title: "入力エラー", description: "ユーザー名とパスワードを入力してください", variant: "destructive" });
      return;
    }

    try {
      if (isLoginMode) {
        await login.mutateAsync({ username: username.trim(), password });
      } else {
        await register.mutateAsync({ username: username.trim(), password });
      }
      setLocation("/");
    } catch (err: any) {
      const msg = err.message?.includes(":") ? err.message.split(":").slice(1).join(":").trim() : err.message;
      let parsed = msg;
      try { parsed = JSON.parse(msg)?.message || msg; } catch {}
      toast({ title: "エラー", description: parsed, variant: "destructive" });
    }
  };

  const isPending = login.isPending || register.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-6 items-center">
        <div className="hidden md:flex flex-col items-center justify-center p-8">
          <div className="h-16 w-16 rounded-xl bg-primary flex items-center justify-center mb-6">
            <Zap className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-3" data-testid="text-app-title">AutoTrade JP</h1>
          <p className="text-muted-foreground text-center text-sm leading-relaxed max-w-xs">
            東京証券取引所上場銘柄の自動売買シミュレーション。MACD・RSI・移動平均線・ボリンジャーバンドのテクニカル分析、AI・量子コンピューティングによる高度な分析を搭載。
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {["テクニカル分析", "AIスコアリング", "量子最適化", "バックテスト", "リスク管理"].map((tag) => (
              <span key={tag} className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-md">{tag}</span>
            ))}
          </div>
        </div>

        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="md:hidden flex items-center justify-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg">AutoTrade JP</span>
            </div>
            <CardTitle data-testid="text-auth-title">{isLoginMode ? "ログイン" : "新規登録"}</CardTitle>
            <CardDescription>
              {isLoginMode ? "アカウントにログインしてください" : "新しいアカウントを作成してください"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">ユーザー名</Label>
                <Input
                  id="username"
                  data-testid="input-username"
                  type="text"
                  placeholder="ユーザー名を入力"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isPending}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  placeholder="パスワードを入力"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isPending}
                  autoComplete={isLoginMode ? "current-password" : "new-password"}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isPending}
                data-testid="button-auth-submit"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : isLoginMode ? (
                  <LogIn className="h-4 w-4 mr-2" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-2" />
                )}
                {isLoginMode ? "ログイン" : "登録"}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
                onClick={() => {
                  setIsLoginMode(!isLoginMode);
                  setUsername("");
                  setPassword("");
                }}
                data-testid="button-toggle-mode"
                disabled={isPending}
              >
                {isLoginMode ? "アカウントをお持ちでない方 → 新規登録" : "既にアカウントをお持ちの方 → ログイン"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
