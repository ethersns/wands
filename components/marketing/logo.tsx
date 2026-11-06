import Link from "next/link";

import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("size-6", className)}
    >
      <rect
        x="1.25"
        y="1.25"
        width="21.5"
        height="21.5"
        rx="6"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="1.5"
      />
      <path
        d="M6.5 15.5 9.4 8.5l2.6 5.1 2.6-5.1 2.9 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex items-center gap-2.5 text-mk-fg transition-opacity hover:opacity-80",
        className,
      )}
      aria-label="Wands home"
    >
      <LogoMark className="size-6 text-mk-accent" />
      <span className="font-display text-[17px] font-semibold tracking-[-0.02em]">
        Wands
      </span>
    </Link>
  );
}
