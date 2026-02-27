import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Zap, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Strategy, Stock } from "@shared/schema";
import { useState } from "react";

const createStrategySchema = z.object({
  name: z.string().min(1, "戦略名を入力してください"),
  stockTicker: z.string().min(1, "銘柄を選択してください"),
  type: z.string().min(1, "タイプを選択してください"),
  buyCondition: z.coerce.number().min(0.1, "正の数を入力してください"),
  sellCondition: z.coerce.number().min(0.1, "正の数を入力してください"),
  quantity: z.coerce.number().int().min(1, "1株以上を指定してください"),
});

type CreateStrategyForm = z.infer<typeof createStrategySchema>;

export default function Strategies() {
  const { data: strategies, isLoading } = useQuery<Strategy[]>({ queryKey: ["/api/strategies"] });
  const { data: stocks } = useQuery<Stock[]>({ queryKey: ["/api/stocks"] });
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<CreateStrategyForm>({
    resolver: zodResolver(createStrategySchema),
    defaultValues: {
      name: "",
      stockTicker: "",
      type: "price_drop_buy",
      buyCondition: 3,
      sellCondition: 5,
      quantity: 100,
    },
  });

  const createStrategy = useMutation({
    mutationFn: async (data: CreateStrategyForm) => {
      await apiRequest("POST", "/api/strategies", { ...data, isActive: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      form.reset();
      setDialogOpen(false);
      toast({ title: "戦略を作成しました", description: "取引戦略が有効になりました" });
    },
    onError: () => {
      toast({ title: "エラー", description: "戦略の作成に失敗しました", variant: "destructive" });
    },
  });

  const toggleStrategy = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/strategies/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
    },
  });

  const deleteStrategy = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/strategies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      toast({ title: "削除完了", description: "戦略を削除しました" });
    },
  });

  const executeStrategy = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/strategies/${id}/execute`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stocks"] });
      toast({ title: "実行完了", description: "戦略の評価が完了しました" });
    },
    onError: (error: Error) => {
      const msg = error.message.replace(/^\d+:\s*/, "");
      toast({ title: "実行結果", description: msg });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const typeLabels: Record<string, string> = {
    price_drop_buy: "下落時買い",
    price_rise_sell: "上昇時売り",
    threshold_buy: "指値買い",
    threshold_sell: "指値売り",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">取引戦略</h1>
          <p className="text-muted-foreground">自動売買ルールの作成と管理</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-strategy">
              <Plus className="h-4 w-4 mr-2" />
              新規戦略
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>取引戦略の作成</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createStrategy.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>戦略名</FormLabel>
                      <FormControl><Input placeholder="例: トヨタ押し目買い" {...field} data-testid="input-strategy-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="stockTicker"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>対象銘柄</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-stock">
                            <SelectValue placeholder="銘柄を選択" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {stocks?.map((s) => (
                            <SelectItem key={s.ticker} value={s.ticker}>{s.ticker} - {s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>戦略タイプ</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="price_drop_buy">下落時買い (下落率%で買い)</SelectItem>
                          <SelectItem value="price_rise_sell">上昇時売り (上昇率%で売り)</SelectItem>
                          <SelectItem value="threshold_buy">指値買い (指定価格以下で買い)</SelectItem>
                          <SelectItem value="threshold_sell">指値売り (指定価格以上で売り)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="buyCondition"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>買い条件</FormLabel>
                        <FormControl><Input type="number" step="0.1" {...field} data-testid="input-buy-condition" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sellCondition"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>売り条件</FormLabel>
                        <FormControl><Input type="number" step="0.1" {...field} data-testid="input-sell-condition" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>数量 (株)</FormLabel>
                      <FormControl><Input type="number" {...field} data-testid="input-quantity" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createStrategy.isPending} data-testid="button-submit-strategy">
                  {createStrategy.isPending ? "作成中..." : "戦略を作成"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {strategies && strategies.length > 0 ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {strategies.map((strategy) => (
            <Card key={strategy.id} className={`hover-elevate ${!strategy.isActive ? "opacity-60" : ""}`} data-testid={`card-strategy-${strategy.id}`}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h3 className="font-semibold">{strategy.name}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="secondary">{strategy.stockTicker}</Badge>
                      <Badge variant="outline">{typeLabels[strategy.type] || strategy.type}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={strategy.isActive}
                      onCheckedChange={(checked) => toggleStrategy.mutate({ id: strategy.id, isActive: checked })}
                      data-testid={`switch-strategy-${strategy.id}`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm mt-4">
                  <div>
                    <p className="text-muted-foreground text-xs">買い条件</p>
                    <p className="font-medium">
                      {strategy.type.includes("threshold") ? `${strategy.buyCondition.toLocaleString("ja-JP")} 円` : `${strategy.buyCondition}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">売り条件</p>
                    <p className="font-medium">
                      {strategy.type.includes("threshold") ? `${strategy.sellCondition.toLocaleString("ja-JP")} 円` : `${strategy.sellCondition}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">数量</p>
                    <p className="font-medium">{strategy.quantity} 株</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => executeStrategy.mutate(strategy.id)}
                    disabled={!strategy.isActive || executeStrategy.isPending}
                    data-testid={`button-execute-${strategy.id}`}
                  >
                    <Zap className="h-3.5 w-3.5 mr-1" />
                    実行
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteStrategy.mutate(strategy.id)}
                    data-testid={`button-delete-${strategy.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Zap className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <h3 className="font-semibold mb-1">戦略がありません</h3>
            <p className="text-muted-foreground text-sm">最初の自動取引戦略を作成しましょう</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
