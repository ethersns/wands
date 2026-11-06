import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A link to the SEC document itself. The terminal links to the filing rather
 * than paraphrasing it, so a reader can check the claim at its source.
 */
export function FilingSourceLink({
  href,
  label = "SEC filing",
  className,
  compact = false,
}: {
  href: string | null | undefined;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  if (!href) {
    return (
      <span
        className={cn("text-[10px] text-muted-foreground", className)}
        title="The engine did not supply a source URL for this record."
      >
        No source link
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 rounded text-[10px] font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {compact ? null : label}
      <ExternalLink className="size-2.5 shrink-0" aria-hidden />
      <span className="sr-only">
        {compact ? "SEC filing" : ""} (opens in a new tab)
      </span>
    </a>
  );
}
