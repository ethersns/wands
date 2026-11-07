import Link from "next/link";

export function Pagination({
  page,
  hasMore,
  basePath,
  params,
}: {
  page: number;
  hasMore: boolean;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (page === 1 && !hasMore) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    search.set("page", String(target));
    return `${basePath}?${search.toString()}`;
  };

  return (
    <nav className="flex items-center justify-between gap-3 border-t border-mk-line px-4 py-3" aria-label="Pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className="text-sm text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline">
          Previous
        </Link>
      ) : (
        <span className="text-sm text-mk-dim">Previous</span>
      )}
      <span className="font-marketing-mono text-[11px] uppercase tracking-[0.12em] text-mk-dim">Page {page}</span>
      {hasMore ? (
        <Link href={href(page + 1)} className="text-sm text-mk-muted underline-offset-4 hover:text-mk-fg hover:underline">
          Next
        </Link>
      ) : (
        <span className="text-sm text-mk-dim">Next</span>
      )}
    </nav>
  );
}
