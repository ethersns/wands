import {
  Activity,
  Bot,
  FlaskConical,
  Globe,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Plug,
  Radar,
  ServerCog,
  Settings,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /**
   * Only active on an exact path match. Required for a parent route such as
   * `/dashboard`, which would otherwise stay highlighted on every child page.
   */
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The founder control centre.
 *
 * Four sections, in the order the business is actually run: what is happening
 * commercially, what research is available, what the trading stack is doing,
 * and the plumbing underneath. Every entry points at a route that exists — the
 * research section reuses the existing operator pages rather than duplicating
 * them, and the member workspace is a link to the real customer app rather than
 * a second copy of it.
 */
export const navGroups: NavGroup[] = [
  {
    label: "Business",
    items: [
      {
        href: "/dashboard",
        label: "Overview",
        icon: LayoutDashboard,
        description: "Members, waitlist and traffic at a glance",
        exact: true,
      },
      {
        href: "/dashboard/members",
        label: "Members",
        icon: Users,
        description: "Accounts, plans and onboarding",
      },
      {
        href: "/dashboard/waitlist",
        label: "Waitlist",
        icon: Inbox,
        description: "Early-access signups",
      },
      {
        href: "/dashboard/traffic",
        label: "Traffic & Analytics",
        icon: Globe,
        description: "Page views and referrers",
      },
      {
        href: "/dashboard/activity",
        label: "Activity",
        icon: Activity,
        description: "Registrations and sign-ins",
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
    label: "Trading operations",
    items: [
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
    ],
  },
  {
    label: "Administration",
    items: [
      {
        href: "/dashboard/system",
        label: "System Health",
        icon: ServerCog,
        description: "Engine, data and collection status",
      },
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        description: "Account and engine",
      },
      {
        href: "/app",
        label: "Member Workspace",
        icon: Users,
        description: "The customer app, as a member",
      },
    ],
  },
];

export const allNavItems = navGroups.flatMap((group) => group.items);

/**
 * Active-state test.
 *
 * A prefix match keeps a section highlighted on its detail pages, but a parent
 * route must opt out with `exact` or `/dashboard` would light up on
 * `/dashboard/members` as well.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The single most specific nav item for a path, for page titles. */
export function navItemFor(pathname: string): NavItem | undefined {
  return allNavItems
    .filter((item) => isNavItemActive(item, pathname))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
