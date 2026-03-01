import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, CreditCard, Coins, ArrowUpRight, ArrowDownRight, ShoppingCart,
  Info, Sparkles, Zap, FlaskConical, ShieldAlert, Atom, Gauge, Award, History,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { useEffect, useRef } from "react";

interface CreditPackage {
  id: string;
  name: string;
  description: string;
  credits: number;
  priceId: string;
  amount: number;
  currency: string;
}

interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  type: string;
  description: string;
  stripeSessionId: string | null;
  taskType: string | null;
  createdAt: string | null;
}

interface CreditCosts {
  [key: string]: { cost: number; label: string };
}

const COST_ICONS: Record<string, any> = {
  backtest_daily: FlaskConical,
  backtest_intraday: FlaskConical,
  benchmark: Award,
  risk_assessment: ShieldAlert,
  portfolio_optimize: Atom,
  var_analysis: Gauge,
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Billing() {
  const { toast } = useToast();
  const search = useSearch();
  const toastShown = useRef(false);

  useEffect(() => {
    if (toastShown.current) return;
    const params = new URLSearchParams(search);
    if (params.get("success") === "true") {
      toastShown.current = true;
      queryClient.invalidateQueries({ queryKey: ["/api/billing/credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/transactions"] });
      toast({ title: "購入完了", description: "クレジットが追加されました" });
      window.history.replaceState({}, "", "/billing");
    } else if (params.get("canceled") === "true") {
      toastShown.current = true;
      toast({ title: "キャンセル", description: "購入がキャンセルされました", variant: "destructive" });
      window.history.replaceState({}, "", "/billing");
    }
  }, [search]);

  const { data: balanceData, isLoading: loadingBalance } = useQuery<{ credits: number }>({
    queryKey: ["/api/billing/credits"],
    refetchInterval: 10000,
  });

  const { data: packages, isLoading: loadingPackages } = useQuery<CreditPackage[]>({
    queryKey: ["/api/billing/packages"],
  });

  const { data: transactions, isLoading: loadingTransactions } = useQuery<CreditTransaction[]>({
    queryKey: ["/api/billing/transactions"],
  });

  const { data: costs } = useQuery<CreditCosts>({
    queryKey: ["/api/billing/costs"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { priceId });
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({ title: "エラー", description: error.message, variant: "destructive" });
    },
  });

  const balance = balanceData?.credits ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-billing-title">クレジット・課金管理</h1>
          <p className="text-sm text-muted-foreground">計算クレジットの購入と使用履歴</p>
        </div>
      </div>

      <Card data-testid="card-credit-balance">
        <CardContent className="pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
                <Coins className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">クレジット残高</p>
                {loadingBalance ? (
                  <Loader2 className="h-6 w-6 animate-spin mt-1" />
                ) : (
                  <p className="text-4xl font-bold tracking-tight" data-testid="text-credit-balance">
                    {balance.toLocaleString("ja-JP")}
                    <span className="text-lg font-normal text-muted-foreground ml-1">cr</span>
                  </p>
                )}
              </div>
            </div>
            <Badge
              variant={balance >= 20 ? "default" : "destructive"}
              className="text-sm px-3 py-1"
              data-testid="badge-credit-status"
            >
              {balance >= 100 ? "十分" : balance >= 20 ? "残りわずか" : "不足"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          クレジットパッケージ
        </h2>
        {loadingPackages ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : packages && packages.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {packages.map((pkg, idx) => {
              const perCredit = pkg.amount / pkg.credits;
              const isPopular = idx === 1;
              const isBestValue = idx === 2;

              return (
                <Card
                  key={pkg.id}
                  className={`relative overflow-hidden transition-shadow hover:shadow-lg ${isPopular ? "border-primary border-2" : ""}`}
                  data-testid={`card-package-${pkg.credits}`}
                >
                  {isPopular && (
                    <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-xs font-medium rounded-bl-lg">
                      人気
                    </div>
                  )}
                  {isBestValue && (
                    <div className="absolute top-0 right-0 bg-emerald-600 text-white px-3 py-1 text-xs font-medium rounded-bl-lg">
                      最もお得
                    </div>
                  )}
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Sparkles className={`h-5 w-5 ${isPopular ? "text-primary" : isBestValue ? "text-emerald-600" : "text-muted-foreground"}`} />
                      {pkg.credits.toLocaleString("ja-JP")} クレジット
                    </CardTitle>
                    <CardDescription>{pkg.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-3xl font-bold" data-testid={`text-package-price-${pkg.credits}`}>
                        ¥{pkg.amount.toLocaleString("ja-JP")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        1cr あたり ¥{(Math.round(perCredit * 100) / 100).toFixed(1)}
                      </p>
                    </div>
                    <Button
                      className="w-full"
                      variant={isPopular ? "default" : "outline"}
                      onClick={() => checkoutMutation.mutate(pkg.priceId)}
                      disabled={checkoutMutation.isPending}
                      data-testid={`button-buy-${pkg.credits}`}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <CreditCard className="h-4 w-4 mr-2" />
                      )}
                      購入する
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>クレジットパッケージの読み込みに失敗しました</p>
              <p className="text-xs mt-1">Stripeの設定を確認してください</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card data-testid="card-credit-costs">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            クレジット消費一覧
          </CardTitle>
          <CardDescription>各機能の実行に必要なクレジット数</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {costs && Object.entries(costs).map(([key, val]) => {
              const Icon = COST_ICONS[key] || Zap;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  data-testid={`cost-item-${key}`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{val.label}</span>
                  </div>
                  <Badge variant="secondary" className="font-mono">
                    {val.cost} cr
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Card data-testid="card-transactions">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            取引履歴
          </CardTitle>
          <CardDescription>クレジットの購入・使用履歴</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTransactions ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !transactions || transactions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>取引履歴がありません</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>説明</TableHead>
                  <TableHead className="text-right">クレジット</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(tx.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={tx.type === "purchase" ? "default" : "secondary"}>
                        {tx.type === "purchase" ? "購入" : "使用"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{tx.description}</TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={`flex items-center justify-end gap-1 ${tx.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                        {tx.amount > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {tx.amount > 0 ? "+" : ""}{tx.amount} cr
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
