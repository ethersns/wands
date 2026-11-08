import type { Metadata } from "next";
import Link from "next/link";

import { ActivationForm } from "@/components/member/activation-form";
import { AuthCard } from "@/components/member/auth-forms";
import { validateActivationToken } from "@/lib/billing/activation";
import { isDatabaseConfigured, query } from "@/lib/db";
import { getMemberSession } from "@/lib/member/session";

export const metadata: Metadata = {
  title: "Activate your account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 1)}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

/**
 * The activation link.
 *
 * The token is validated on the server before anything is rendered, and the
 * page decides between "choose a password" and "sign in to attach" by looking
 * at whether the address already has an account. That decision is made here
 * rather than in the browser so the client cannot ask for the wrong mode.
 */
export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";
  const state = await validateActivationToken(token);

  if (!state.ok) {
    const copy = {
      used: {
        title: "This link has already been used",
        subtitle: "Activation links work once.",
        body: "If you have already set your password, sign in to continue. If you have not, contact support and we will send a new link.",
      },
      expired: {
        title: "This link has expired",
        subtitle: "Activation links last 24 hours.",
        body: "Contact support and we will send a fresh activation link to the address you paid with.",
      },
      unpaid: {
        title: "Payment is not confirmed yet",
        subtitle: "Your account will unlock once Stripe confirms it.",
        body: "Nothing is wrong with the link — the payment simply has not settled. Try again in a few minutes.",
      },
      invalid: {
        title: "That link is not valid",
        subtitle: "It may have been copied incompletely.",
        body: "Open the link directly from the activation email, or contact support if it still does not work.",
      },
    }[state.reason];

    return (
      <AuthCard
        title={copy.title}
        subtitle={copy.subtitle}
        footer={
          <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
            Go to sign in
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-mk-muted">{copy.body}</p>
      </AuthCard>
    );
  }

  const { intent } = state.lookup;

  const existing = isDatabaseConfigured()
    ? await query<{ id: string }>(
        `select id from "user" where lower(email) = $1 limit 1`,
        [intent.email],
      )
    : [];

  const session = await getMemberSession();
  const signedInAsOwner =
    Boolean(session) &&
    session!.user.email.trim().toLowerCase() === intent.email;

  const mode = existing[0] ? "attach" : "create";

  if (mode === "attach" && !signedInAsOwner) {
    return (
      <AuthCard
        title="Sign in to attach your membership"
        subtitle={`${maskEmail(intent.email)} already has a Wands account.`}
        footer={
          <Link href="/forgot-password" className="text-mk-accent underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-mk-muted">
          Your payment is confirmed. Sign in to the existing account and the
          membership will be attached to it — nothing you have saved is lost.
        </p>
        <Link
          href={`/signin?next=${encodeURIComponent(`/activate?token=${token}`)}`}
          className="inline-flex w-full items-center justify-center rounded-lg bg-mk-accent px-4 py-2.5 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
        >
          Sign in to continue
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Activate your Wands account"
      subtitle={`Payment confirmed for ${maskEmail(intent.email)}.`}
      footer={
        <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ActivationForm token={token} mode={mode} email={intent.email} />
    </AuthCard>
  );
}
