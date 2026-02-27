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
  name: z.string().min(1, "Strategy name is required"),
  stockTicker: z.string().min(1, "Stock is required"),
  type: z.string().min(1, "Type is required"),
  buyCondition: z.coerce.number().min(0.1, "Must be positive"),
  sellCondition: z.coerce.number().min(0.1, "Must be positive"),
  quantity: z.coerce.number().int().min(1, "Minimum 1 share"),
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
      toast({ title: "Strategy Created", description: "Your trading strategy is now active" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create strategy", variant: "destructive" });
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
      toast({ title: "Deleted", description: "Strategy has been removed" });
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
      toast({ title: "Executed", description: "Strategy evaluation completed" });
    },
    onError: (error: Error) => {
      const msg = error.message.replace(/^\d+:\s*/, "");
      toast({ title: "Execution Result", description: msg });
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
    price_drop_buy: "Price Drop Buy",
    price_rise_sell: "Price Rise Sell",
    threshold_buy: "Threshold Buy",
    threshold_sell: "Threshold Sell",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Trading Strategies</h1>
          <p className="text-muted-foreground">Create and manage automated trading rules</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-strategy">
              <Plus className="h-4 w-4 mr-2" />
              New Strategy
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Trading Strategy</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createStrategy.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Strategy Name</FormLabel>
                      <FormControl><Input placeholder="e.g. Toyota Dip Buy" {...field} data-testid="input-strategy-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="stockTicker"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stock</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-stock">
                            <SelectValue placeholder="Select a stock" />
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
                      <FormLabel>Strategy Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="price_drop_buy">Price Drop Buy (buy on dip %)</SelectItem>
                          <SelectItem value="price_rise_sell">Price Rise Sell (sell on rise %)</SelectItem>
                          <SelectItem value="threshold_buy">Threshold Buy (buy below price)</SelectItem>
                          <SelectItem value="threshold_sell">Threshold Sell (sell above price)</SelectItem>
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
                        <FormLabel>Buy Condition</FormLabel>
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
                        <FormLabel>Sell Condition</FormLabel>
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
                      <FormLabel>Quantity (shares)</FormLabel>
                      <FormControl><Input type="number" {...field} data-testid="input-quantity" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createStrategy.isPending} data-testid="button-submit-strategy">
                  {createStrategy.isPending ? "Creating..." : "Create Strategy"}
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
                    <p className="text-muted-foreground text-xs">Buy at</p>
                    <p className="font-medium">
                      {strategy.type.includes("threshold") ? `${strategy.buyCondition.toLocaleString("ja-JP")} JPY` : `${strategy.buyCondition}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Sell at</p>
                    <p className="font-medium">
                      {strategy.type.includes("threshold") ? `${strategy.sellCondition.toLocaleString("ja-JP")} JPY` : `${strategy.sellCondition}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Quantity</p>
                    <p className="font-medium">{strategy.quantity} shares</p>
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
                    Execute
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
            <h3 className="font-semibold mb-1">No strategies yet</h3>
            <p className="text-muted-foreground text-sm">Create your first automated trading strategy</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
