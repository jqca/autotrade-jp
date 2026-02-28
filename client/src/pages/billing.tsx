import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, CreditCard, Coins, ArrowUpRight, ArrowDownRight, ShoppingCart, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";

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

export default function Billing() {
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);

  if (params.get("success") === "true") {
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/transactions"] });
      toast({ title: "購入完了", description: "クレジットが追加されました" });
    }, 500);
  }

  const { data: balanceData, isLoading: loadingBalance } = useQuery<{ credits: number }>({
    queryKey: ["/api/billing/credits"],
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
    mutationFn: async (pkg: CreditPackage) => {
      const res = await apiRequest("POST", "/api/billing/checkout", {
        priceId: pkg.priceId,
      });
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

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-billing-title">クレジット・課金管理</h1>
        <p className="text-muted-foreground">計算クレジットの購入と使用履歴</p>
      </div>

      <Card data-testid="card-credit-balance">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-yellow-500" />
            クレジット残高
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingBalance ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold" data-testid="text-credit-balance">
                {(balanceData?.credits ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground text-lg">クレジット</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          クレジットパッケージ
        </h2>
        {loadingPackages ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(packages || []).map((pkg) => (
              <Card key={pkg.id} className="relative" data-testid={`card-package-${pkg.credits}`}>
                {pkg.credits === 1000 && (
                  <Badge className="absolute -top-2 -right-2 bg-orange-500">お得</Badge>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{pkg.credits.toLocaleString()} クレジット</CardTitle>
                  <CardDescription>{pkg.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-2xl font-bold">
                    ¥{(pkg.amount).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ¥{(pkg.amount / pkg.credits).toFixed(1)} / クレジット
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => checkoutMutation.mutate(pkg)}
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
            ))}
          </div>
        )}
      </div>

      <Card data-testid="card-credit-costs">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            クレジット消費一覧
          </CardTitle>
          <CardDescription>各機能の実行に必要なクレジット数</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>機能</TableHead>
                <TableHead className="text-right">消費クレジット</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costs && Object.entries(costs).map(([key, val]) => (
                <TableRow key={key} data-testid={`row-cost-${key}`}>
                  <TableCell>{val.label}</TableCell>
                  <TableCell className="text-right font-mono">{val.cost} cr</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="card-transactions">
        <CardHeader className="pb-3">
          <CardTitle>取引履歴</CardTitle>
          <CardDescription>クレジットの購入・使用履歴</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTransactions ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !transactions || transactions.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">取引履歴がありません</p>
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
                      {tx.createdAt ? new Date(tx.createdAt).toLocaleString("ja-JP") : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={tx.type === "purchase" ? "default" : "secondary"}>
                        {tx.type === "purchase" ? "購入" : "使用"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{tx.description}</TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={`flex items-center justify-end gap-1 ${tx.amount > 0 ? "text-green-600" : "text-red-500"}`}>
                        {tx.amount > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {tx.amount > 0 ? "+" : ""}{tx.amount}
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
