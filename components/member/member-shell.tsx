"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  Bookmark,
  CreditCard,
  LayoutGrid,
  ListChecks,
  Menu,
  Radar,
  Settings,
  Sparkles,
  X,
} from "lucide-react";

import { Logo } from "@/components/marketing/logo";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./sign-out-button";

const NAV = [
  { href: "/app", label: "Overview", icon: LayoutGrid },
  { href: "/app/watchlists", label: "Watchlists", icon: ListChecks },
  { href: "/app/insiders", label: "Insiders", icon: Radar },
  { href: "/app/signals", label: "Signals", icon: Sparkles },
  { href: "/app/saved", label: "Saved", icon: Bookmark },
  { href: "/app/notifications", label: "Notifications", icon: Bell },
];

const FOOTER_NAV = [
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
  children,
}: {
  name: string;
  email: string;
  planLabel: string;
  unread: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1" aria-label="Workspace">
      {NAV.map((item) => {
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
              active
                ? "bg-mk-raised text-mk-fg"
                : "text-mk-muted hover:bg-mk-surface hover:text-mk-fg",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", active ? "text-mk-accent" : "text-mk-dim group-hover:text-mk-muted")}
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
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-1 border-t border-mk-line pt-3">
      {FOOTER_NAV.map((item) => {
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
          {nav}
          {identity}
          {footer}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-mk-line bg-mk-bg/85 px-4 py-3 backdrop-blur lg:hidden">
            <Logo href="/app" />
            <button
              type="button"
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
              <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-5 border-r border-mk-line bg-mk-bg px-4 py-5">
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
                {nav}
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
