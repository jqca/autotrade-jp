import { LayoutDashboard, Eye, Zap, History, Wallet, Signal, FlaskConical, ShieldAlert, Atom } from "lucide-react";
import { useLocation, Link } from "wouter";
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
} from "@/components/ui/sidebar";

const navItems = [
  { title: "ダッシュボード", url: "/", icon: LayoutDashboard, testId: "link-dashboard" },
  { title: "ウォッチリスト", url: "/watchlist", icon: Eye, testId: "link-watchlist" },
  { title: "売買シグナル", url: "/signals", icon: Signal, testId: "link-signals" },
  { title: "バックテスト", url: "/backtest", icon: FlaskConical, testId: "link-backtest" },
  { title: "リスクアラート", url: "/risk", icon: ShieldAlert, testId: "link-risk" },
  { title: "量子ポートフォリオ", url: "/optimize", icon: Atom, testId: "link-optimize" },
  { title: "取引戦略", url: "/strategies", icon: Zap, testId: "link-strategies" },
  { title: "取引履歴", url: "/trades", icon: History, testId: "link-trades" },
  { title: "ポートフォリオ", url: "/portfolio", icon: Wallet, testId: "link-portfolio" },
];

export function AppSidebar() {
  const [location] = useLocation();

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
    </Sidebar>
  );
}
