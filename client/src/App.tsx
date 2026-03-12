import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Watchlist from "@/pages/watchlist";
import Strategies from "@/pages/strategies";
import Trades from "@/pages/trades";
import Portfolio from "@/pages/portfolio";
import StockDetail from "@/pages/stock-detail";
import Signals from "@/pages/signals";
import Backtest from "@/pages/backtest";
import RiskAlert from "@/pages/risk-alert";
import PortfolioOptimize from "@/pages/portfolio-optimize";
import VarAnalysis from "@/pages/var-analysis";
import QuantumBenchmark from "@/pages/quantum-benchmark";
import EnergyMonitor from "@/pages/energy-monitor";
import Billing from "@/pages/billing";
import SettingsPage from "@/pages/settings";
import KabuOrders from "@/pages/kabu-orders";
import AuthPage from "@/pages/auth-page";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/stocks/:ticker" component={StockDetail} />
      <Route path="/signals" component={Signals} />
      <Route path="/backtest" component={Backtest} />
      <Route path="/risk" component={RiskAlert} />
      <Route path="/optimize" component={PortfolioOptimize} />
      <Route path="/var" component={VarAnalysis} />
      <Route path="/benchmark" component={QuantumBenchmark} />
      <Route path="/energy" component={EnergyMonitor} />
      <Route path="/billing" component={Billing} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/kabu-orders" component={KabuOrders} />
      <Route path="/strategies" component={Strategies} />
      <Route path="/trades" component={Trades} />
      <Route path="/portfolio" component={Portfolio} />
      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3rem",
};

function AuthenticatedApp() {
  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-1 p-2 border-b">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
