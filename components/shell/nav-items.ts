import {
  Bot,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  Plug,
  Settings,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Operate",
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        description: "Command centre",
      },
      {
        href: "/portfolio",
        label: "Portfolio",
        icon: Wallet,
        description: "Holdings and allocation",
      },
      {
        href: "/markets",
        label: "Markets",
        icon: TrendingUp,
        description: "Watchlists and charts",
      },
      {
        href: "/bots",
        label: "Trading Bots",
        icon: Bot,
        description: "Automated strategies",
      },
      {
        href: "/orders",
        label: "Trades & Orders",
        icon: ListOrdered,
        description: "Execution history",
      },
    ],
  },
  {
    label: "Research",
    items: [
      {
        href: "/strategy-lab",
        label: "Strategy Lab",
        icon: FlaskConical,
        description: "Backtest and validate",
      },
      {
        href: "/research",
        label: "AI Research",
        icon: Sparkles,
        description: "Market analysis assistant",
      },
    ],
  },
  {
    label: "Control",
    items: [
      {
        href: "/risk",
        label: "Risk Centre",
        icon: ShieldAlert,
        description: "Limits and circuit breakers",
      },
      {
        href: "/connections",
        label: "Connections",
        icon: Plug,
        description: "Exchanges and brokers",
      },
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        description: "Account and engine",
      },
    ],
  },
];

export const allNavItems = navGroups.flatMap((group) => group.items);

export function navItemFor(pathname: string): NavItem | undefined {
  if (pathname === "/") return allNavItems[0];
  return allNavItems.find(
    (item) => item.href !== "/" && pathname.startsWith(item.href),
  );
}
