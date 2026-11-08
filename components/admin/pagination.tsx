import Link from "next/link";

import { cn } from "@/lib/utils";

function hrefFor(
  basePath: string,
  page: number,
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  search.set("page", String(page));
  return `${basePath}?${search.toString()}`;
}

/**
 * Bounded pagination.
 *
 * Every admin list is paginated server-side, so this control only ever links to
 * a page number — it never asks for "all rows". The row count is announced so
 * an operator can tell an empty result from a filtered one.
 */
export function AdminPagination({
  page,
  pageCount,
  total,
  pageSize,
  basePath,
  params = {},
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const linkClass =
    "rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted";
  const disabledClass =
    "rounded-md border border-border/50 px-2.5 py-1 text-[11px] text-muted-foreground/50";

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 sm:px-5"
    >
      <p className="font-mono text-[11px] tabular text-muted-foreground">
        {total === 0 ? "No rows" : `${first}–${last} of ${total}`}
      </p>

      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link href={hrefFor(basePath, page - 1, params)} className={linkClass} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            Previous
          </span>
        )}

        <span className={cn("px-1 font-mono text-[11px] tabular text-muted-foreground")}>
          {page} / {Math.max(pageCount, 1)}
        </span>

        {page < pageCount ? (
          <Link href={hrefFor(basePath, page + 1, params)} className={linkClass} rel="next">
            Next
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
