"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/intelligence", label: "Overview" },
  { href: "/intelligence/insiders", label: "Insider Radar" },
  { href: "/intelligence/institutions", label: "Institutional Radar" },
  { href: "/intelligence/performance", label: "Performance" },
  { href: "/intelligence/coverage", label: "Data Coverage" },
  { href: "/intelligence/operations", label: "Operations" },
];

export function IntelNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Intelligence sections"
      className="-mx-3 overflow-x-auto border-b border-border px-3 sm:-mx-5 sm:px-5 lg:-mx-7 lg:px-7"
    >
      <ul className="flex min-w-max items-center gap-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/intelligence"
              ? pathname === "/intelligence"
              : pathname.startsWith(tab.href);

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex items-center px-2.5 py-2 text-[12px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "absolute inset-x-1.5 -bottom-px h-px",
                    active ? "bg-primary" : "bg-transparent",
                  )}
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
