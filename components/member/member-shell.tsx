"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  BellRing,
  Bookmark,
  CalendarClock,
  ChevronDown,
  CreditCard,
  FlaskConical,
  Landmark,
  LayoutGrid,
  ListChecks,
  Menu,
  Radar,
  Search,
  Settings,
  Sparkles,
  Target,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "@/components/marketing/logo";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./sign-out-button";

type MemberNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Hidden from members who do not hold the founder grant. This is a
   * convenience, not a boundary: the page and every desk action authorise the
   * caller on the server regardless of what the navigation renders.
   */
  founderOnly?: boolean;
};

type MemberNavGroup = {
  id: "workspace" | "research" | "tools";
  label: string;
  collapsible?: boolean;
  items: MemberNavItem[];
};

export const MEMBER_NAV_GROUPS: MemberNavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { href: "/app", label: "Overview", icon: LayoutGrid },
      { href: "/app/opportunity", label: "Discover", icon: Target, founderOnly: true },
      { href: "/app/watchlists", label: "Watchlists", icon: ListChecks },
      { href: "/app/money", label: "Money / Journal", icon: Wallet, founderOnly: true },
    ],
  },
  {
    id: "research",
    label: "Research & Labs",
    collapsible: true,
    items: [
      { href: "/app/research", label: "Research", icon: Search },
      { href: "/app/insiders", label: "Insiders", icon: Radar },
      { href: "/app/institutions", label: "Institutions", icon: Landmark },
      { href: "/app/signals", label: "Signals", icon: Sparkles },
      { href: "/app/catalysts", label: "Catalyst Radar", icon: CalendarClock },
      { href: "/app/quant-lab", label: "Quant Lab", icon: FlaskConical },
    ],
  },
  {
    id: "tools",
    label: "More Tools",
    collapsible: true,
    items: [
      { href: "/app/saved", label: "Saved", icon: Bookmark },
      { href: "/app/alerts", label: "Alerts", icon: BellRing },
      { href: "/app/notifications", label: "Notifications", icon: Bell },
    ],
  },
];

export const MEMBER_NAV = MEMBER_NAV_GROUPS.flatMap((group) => group.items);

export function getMemberNavGroups(founder: boolean) {
  return MEMBER_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.founderOnly || founder),
  })).filter((group) => group.items.length > 0);
}

export const MEMBER_FOOTER_NAV = [
  { href: "/app/membership", label: "Membership", icon: CreditCard },
  { href: "/app/account", label: "Account", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

export function MemberShell({
  name,
  email,
  planLabel,
  unread,
  founder,
  children,
}: {
  name: string;
  email: string;
  planLabel: string;
  unread: number;
  founder: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({ research: false, tools: false });
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const navGroups = getMemberNavGroups(founder);
  const researchActive = navGroups.find((group) => group.id === "research")?.items.some((item) => isActive(pathname, item.href)) ?? false;
  const toolsActive = navGroups.find((group) => group.id === "tools")?.items.some((item) => isActive(pathname, item.href)) ?? false;

  useEffect(() => {
    setExpandedGroups((current) => ({
      research: current.research || researchActive,
      tools: current.tools || toolsActive,
    }));
  }, [researchActive, toolsActive]);

  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    const menuButton = menuButtonRef.current;
    const focusable = () => drawer?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable()?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      menuButton?.focus();
    };
  }, [open]);

  const nav = (surface: "desktop" | "mobile") => (
    <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" aria-label="Workspace">
      {navGroups.map((group) => {
        const active = group.items.some((item) => isActive(pathname, item.href));
        const expanded = group.id === "research"
          ? expandedGroups.research
          : group.id === "tools"
            ? expandedGroups.tools
            : true;
        const groupContentId = `member-nav-${surface}-${group.id}`;
        return (
          <section key={group.id} className="flex flex-col gap-1">
            {group.collapsible ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={groupContentId}
                onClick={() => setExpandedGroups((current) => ({ ...current, [group.id]: !expanded }))}
                className="flex items-center justify-between rounded-md px-3 py-1.5 text-left font-marketing-mono text-[10px] font-medium uppercase tracking-[0.14em] text-mk-dim transition-colors hover:text-mk-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-accent"
              >
                <span>{group.label}</span>
                <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
              </button>
            ) : (
              <h2 className="px-3 py-1.5 font-marketing-mono text-[10px] font-medium uppercase tracking-[0.14em] text-mk-dim">
                {group.label}
              </h2>
            )}
            {expanded ? (
              <div id={groupContentId} className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const itemActive = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={itemActive ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        itemActive
                          ? "bg-mk-raised text-mk-fg"
                          : "text-mk-muted hover:bg-mk-surface hover:text-mk-fg",
                      )}
                    >
                      <Icon
                        className={cn("size-4 shrink-0", itemActive ? "text-mk-accent" : "text-mk-dim group-hover:text-mk-muted")}
                        aria-hidden
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/app/notifications" && unread > 0 ? (
                        <span className="rounded-full bg-mk-accent px-1.5 py-0.5 font-marketing-mono text-[10px] font-semibold text-mk-accent-ink">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ) : null}
            {active && !expanded ? <span className="sr-only">Active section: {group.label}</span> : null}
          </section>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-1 border-t border-mk-line pt-3">
      <h2 className="px-3 py-1.5 font-marketing-mono text-[10px] font-medium uppercase tracking-[0.14em] text-mk-dim">
        Account
      </h2>
      {MEMBER_FOOTER_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-mk-raised text-mk-fg" : "text-mk-muted hover:bg-mk-surface hover:text-mk-fg",
            )}
          >
            <Icon className="size-4 shrink-0 text-mk-dim group-hover:text-mk-muted" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <SignOutButton />
    </div>
  );

  const identity = (
    <div className="rounded-lg border border-mk-line bg-mk-surface px-3 py-2.5">
      <p className="truncate text-sm text-mk-fg">{name}</p>
      <p className="truncate font-marketing-mono text-[11px] text-mk-dim">{email}</p>
      <p className="mt-1.5 inline-flex items-center gap-1.5 font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-accent">
        <span className="size-1 rounded-full bg-mk-accent" aria-hidden />
        {planLabel}
      </p>
    </div>
  );

  return (
    <div className="mk-shell min-h-dvh">
      <a
        href="#workspace-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-mk-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-mk-accent-ink"
      >
        Skip to content
      </a>

      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-mk-line px-4 py-5 lg:flex">
          <Logo href="/app" />
          {nav("desktop")}
          {identity}
          {footer}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-mk-line bg-mk-bg/85 px-4 py-3 backdrop-blur lg:hidden">
            <Logo href="/app" />
            <button
              type="button"
              ref={menuButtonRef}
              onClick={() => setOpen(true)}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-mk-line text-mk-muted transition-colors hover:text-mk-fg"
              aria-label="Open navigation"
              aria-expanded={open}
            >
              <Menu className="size-4" aria-hidden />
            </button>
          </header>

          {open ? (
            <div className="fixed inset-0 z-50 lg:hidden">
              <button
                type="button"
                className="absolute inset-0 bg-mk-deep/80 backdrop-blur-sm"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
              />
              <div
                ref={drawerRef}
                role="dialog"
                aria-modal="true"
                aria-label="Workspace navigation"
                className="absolute inset-y-0 left-0 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-5 overflow-y-auto border-r border-mk-line bg-mk-bg px-4 py-5"
              >
                <div className="flex items-center justify-between">
                  <Logo href="/app" />
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-mk-muted hover:text-mk-fg"
                    aria-label="Close navigation"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
                {nav("mobile")}
                {identity}
                {footer}
              </div>
            </div>
          ) : null}

          <main id="workspace-main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
