"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The control centre's section navigation.
 *
 * Overview and Waitlist are also top-level sidebar entries. They appear here as
 * well because the owner's mental model is one Members area, and having to
 * leave it to reach the waitlist breaks that. The sidebar stays as it is so the
 * existing routes keep working.
 */
const TABS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/members", label: "All members", exact: true },
  { href: "/dashboard/waitlist", label: "Waitlist", exact: true },
  { href: "/dashboard/members/suspended", label: "Suspended", exact: true },
  { href: "/dashboard/members/billing", label: "Billing", exact: true },
  { href: "/dashboard/members/security", label: "Security activity", exact: true },
] as const;

export function MemberTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Member administration sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 px-1">
        {TABS.map((tab) => {
          // A member profile lives under /dashboard/members/[id], so the
          // directory tab stays active there rather than nothing being active.
          const active =
            pathname === tab.href ||
            (tab.href === "/dashboard/members" &&
              pathname.startsWith("/dashboard/members/") &&
              !pathname.startsWith("/dashboard/members/suspended") &&
              !pathname.startsWith("/dashboard/members/billing") &&
              !pathname.startsWith("/dashboard/members/security"));

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-md px-2.5 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
