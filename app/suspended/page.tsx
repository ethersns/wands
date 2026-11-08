import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export const metadata: Metadata = {
  title: "Account suspended",
  robots: { index: false, follow: false },
};

/**
 * Where a suspended member lands.
 *
 * Deliberately outside the member workspace: the workspace layout calls
 * `requireMember`, which redirects here, so rendering this page inside that
 * layout would loop. It is also outside the operator tier, because the person
 * reading it is a customer, not an operator.
 *
 * The page does not say why the account was suspended. The reason is recorded
 * for the operator's audit trail, and disclosing it to whoever holds the
 * session would leak an internal note to a possibly-compromised browser.
 */
export default function SuspendedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6">
        <div className="flex size-10 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive">
          <ShieldAlert className="size-5" aria-hidden />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-foreground">
          This account is suspended
        </h1>

        <p className="mt-2 text-[13px] leading-relaxed text-pretty text-muted-foreground">
          Sign-in is disabled and any active session has been ended. Your data has not been
          deleted, and access can be restored.
        </p>

        <p className="mt-3 text-[13px] leading-relaxed text-pretty text-muted-foreground">
          If you believe this is a mistake, reply to any email from us or contact support and
          we will review it.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-md border border-border px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            Back to the site
          </Link>
          <Link
            href="/signin"
            className="inline-flex h-9 items-center rounded-md px-3.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Try signing in
          </Link>
        </div>
      </div>
    </main>
  );
}
