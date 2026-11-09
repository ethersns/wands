import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";

/**
 * A success message that outlives the row that produced it.
 *
 * A reactivated account leaves the suspended list, so the table row — and the
 * dialog inside it — unmounts the moment the page refreshes. A message held in
 * that dialog's state would disappear with it, leaving the operator with a row
 * that silently vanished. The outcome is therefore carried in the URL and
 * rendered here, above the table, where it survives the refresh.
 */
export function ActionFlash({
  message,
  dismissHref,
}: {
  message: string;
  dismissHref: string;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-profit/30 bg-profit/10 px-3 py-2.5"
    >
      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-profit" aria-hidden />
      <p className="flex-1 text-[12px] leading-relaxed text-foreground">{message}</p>
      <Link
        href={dismissHref}
        aria-label="Dismiss message"
        className="-m-1 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}
