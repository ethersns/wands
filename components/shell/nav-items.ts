import {
  Bot,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  Plug,
  Radar,
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
        href: "/dashboard",
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
        href: "/intelligence",
        label: "Intelligence",
        icon: Radar,
        description: "SEC filings and signals",
      },
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
  return allNavItems.find((item) => pathname.startsWith(item.href));
}
