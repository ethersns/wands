import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

function hrefWith(
  basePath: string,
  params: Record<string, string | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Backend pagination. The engine pages the feed, so the browser never holds
 * more than one page of research records.
 */
export function Pagination({
  basePath,
  params,
  page,
  limit,
  total,
  hasMore,
  className,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  className?: string;
}) {
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);
  const canGoBack = page > 1;
  const canGoForward = hasMore || page * limit < total;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 sm:px-5",
        className,
      )}
    >
      <p className="font-mono text-[10px] text-muted-foreground">
        {total === 0 ? "0 records" : `${first}–${last} of ${total}`}
        <span className="ml-1.5 text-muted-foreground/60">page {page}</span>
      </p>
      <div className="flex items-center gap-1.5">
        {canGoBack ? (
          <Link
            href={hrefWith(basePath, params, page - 1)}
            rel="prev"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronLeft className="size-3" aria-hidden />
            Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground/50"
          >
            <ChevronLeft className="size-3" aria-hidden />
            Previous
          </span>
        )}
        {canGoForward ? (
          <Link
            href={hrefWith(basePath, params, page + 1)}
            rel="next"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Next
            <ChevronRight className="size-3" aria-hidden />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground/50"
          >
            Next
            <ChevronRight className="size-3" aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}
