import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/member/auth-forms";
import { PendingRefresh } from "@/components/member/pending-refresh";
import { getSignupIntent } from "@/lib/billing/signup-intent";

export const metadata: Metadata = {
  title: "Payment status",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 1)}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

/**
 * Where Stripe sends the customer after checkout.
 *
 * This page is a report, not a grant. It reads the signup intent the webhook
 * maintains and says what that record actually shows — opening the success URL
 * proves nothing, so a visitor who types it in sees the same "being confirmed"
 * state as anyone else until Stripe has confirmed the payment.
 */
export default async function PaymentConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const params = await searchParams;
  const intent = params.intent ? await getSignupIntent(params.intent) : null;

  if (!intent) {
    return (
      <AuthCard
        title="We could not find that signup"
        subtitle="This link does not match a checkout we have a record of."
        footer={
          <Link href="/signup" className="text-mk-accent underline-offset-4 hover:underline">
            Start again
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-mk-muted">
          If you completed a payment, check your inbox for the activation link. If
          you did not, nothing has been charged.
        </p>
      </AuthCard>
    );
  }

  const address = maskEmail(intent.email);

  if (intent.status === "activated") {
    return (
      <AuthCard
        title="Your account is active"
        subtitle={`The membership for ${address} is already set up.`}
        footer={
          <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-mk-muted">
          Sign in to pick up where you left off.
        </p>
      </AuthCard>
    );
  }

  if (intent.status === "paid") {
    return (
      <AuthCard
        title="Payment confirmed. Let's activate your Wands account."
        subtitle={`We sent an activation link to ${address}.`}
        footer={
          <Link href="/signin" className="text-mk-accent underline-offset-4 hover:underline">
            Already activated? Sign in
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-mk-muted">
          Open the link to set your password and finish setting up your workspace.
          It can be used once and expires in 24 hours.
        </p>
      </AuthCard>
    );
  }

  if (intent.status === "pending") {
    return (
      <AuthCard
        title="Your payment is being confirmed"
        subtitle="Your account will unlock once Stripe confirms it."
        footer={
          <Link href="/contact" className="text-mk-accent underline-offset-4 hover:underline">
            Something wrong? Contact us
          </Link>
        }
      >
        <PendingRefresh />
        <p className="text-sm leading-relaxed text-mk-muted">
          This page updates on its own. You can also close it — the activation
          link arrives by email as soon as the payment settles.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Your payment wasn't completed"
      subtitle="No research access has been activated."
      footer={
        <Link href="/signup" className="text-mk-accent underline-offset-4 hover:underline">
          Try again
        </Link>
      }
    >
      <p className="text-sm leading-relaxed text-mk-muted">
        Nothing was charged and no account was created. You can start a new
        checkout whenever you are ready.
      </p>
    </AuthCard>
  );
}
