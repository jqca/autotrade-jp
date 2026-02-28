import { LayoutDashboard, Eye, Zap, History, Wallet, Signal, FlaskConical, ShieldAlert, Atom, Gauge, Award, BatteryCharging, CreditCard, LogOut, User } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "ダッシュボード", url: "/", icon: LayoutDashboard, testId: "link-dashboard" },
  { title: "ウォッチリスト", url: "/watchlist", icon: Eye, testId: "link-watchlist" },
  { title: "売買シグナル", url: "/signals", icon: Signal, testId: "link-signals" },
  { title: "バックテスト", url: "/backtest", icon: FlaskConical, testId: "link-backtest" },
  { title: "リスクアラート", url: "/risk", icon: ShieldAlert, testId: "link-risk" },
  { title: "量子ポートフォリオ", url: "/optimize", icon: Atom, testId: "link-optimize" },
  { title: "量子VaR分析", url: "/var", icon: Gauge, testId: "link-var" },
  { title: "量子ベンチマーク", url: "/benchmark", icon: Award, testId: "link-benchmark" },
  { title: "消費電力モニター", url: "/energy", icon: BatteryCharging, testId: "link-energy" },
  { title: "クレジット・課金", url: "/billing", icon: CreditCard, testId: "link-billing" },
  { title: "取引戦略", url: "/strategies", icon: Zap, testId: "link-strategies" },
  { title: "取引履歴", url: "/trades", icon: History, testId: "link-trades" },
  { title: "ポートフォリオ", url: "/portfolio", icon: Wallet, testId: "link-portfolio" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-bold text-sm leading-tight">AutoTrade JP</h2>
            <p className="text-xs text-muted-foreground leading-tight">自動株式取引</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>メニュー</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url} className="data-[active=true]:bg-sidebar-accent">
                    <Link href={item.url} data-testid={item.testId}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 border-t">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm truncate text-muted-foreground" data-testid="text-current-user">{user?.username}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
