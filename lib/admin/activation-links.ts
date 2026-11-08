import "server-only";

import {
  activationUrl,
  issueActivationToken,
  revokeLiveActivationTokens,
} from "@/lib/billing/activation";
import { MEMBER_PLANS, isMemberPlanId } from "@/lib/billing/config";
import { isDatabaseConfigured, query } from "@/lib/db";
import {
  activationEmail,
  emailDeliveryConfigured,
  sendTransactionalEmail,
} from "@/lib/email/send";
import { siteUrl } from "@/lib/marketing/site";

import { recordAdminAction } from "./audit";

/**
 * Operator-issued activation links.
 *
 * A paid signup becomes an account only by following the activation link the
 * webhook emails. When no email provider is configured — or when the message
 * never arrives — that link is the one thing standing between a paying
 * customer and a workspace they cannot enter.
 *
 * The token is stored only as a SHA-256 hash, so an existing link cannot be
 * read back out of the database, by the operator or by anyone else. The only
 * honest way to hand a link to a customer is therefore to mint a new one and
 * show it once, at the moment it is created. Minting revokes any live link
 * first, so a customer is never left holding two working links.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PendingActivation {
  intentId: string;
  email: string;
  plan: string;
  paidAt: string | null;
  createdAt: string;
  /** When the link the customer already holds stops working, if any. */
  liveLinkExpiresAt: string | null;
  lastLinkIssuedAt: string | null;
}

interface PendingRow {
  intent_id: string;
  email: string;
  plan: string;
  paid_at: Date | null;
  created_at: Date;
  live_expires_at: Date | null;
  last_issued_at: Date | null;
}

/**
 * Paid signups that have not become accounts.
 *
 * `status = 'paid'` is the whole definition: an activated intent is done, and
 * anything earlier never settled a payment, so neither belongs in a list of
 * people waiting to get in.
 */
export async function listPendingActivations(limit = 25): Promise<PendingActivation[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    const rows = await query<PendingRow>(
      `select i.id::text as intent_id, i.email_normalized as email, i.plan,
              i.paid_at, i.created_at,
              live.expires_at as live_expires_at,
              last.created_at as last_issued_at
       from member_signup_intent i
       left join lateral (
         select expires_at
         from member_activation_token
         where intent_id = i.id and used_at is null and expires_at > now()
         order by created_at desc
         limit 1
       ) live on true
       left join lateral (
         select created_at
         from member_activation_token
         where intent_id = i.id
         order by created_at desc
         limit 1
       ) last on true
       where i.status = 'paid'
       order by i.paid_at desc nulls last, i.created_at desc
       limit $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );

    return rows.map((row) => ({
      intentId: row.intent_id,
      email: row.email,
      plan: row.plan,
      paidAt: row.paid_at ? row.paid_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
      liveLinkExpiresAt: row.live_expires_at ? row.live_expires_at.toISOString() : null,
      lastLinkIssuedAt: row.last_issued_at ? row.last_issued_at.toISOString() : null,
    }));
  } catch (cause) {
    console.error("[wands] pending activation read failed", {
      error: cause instanceof Error ? cause.message : "unknown",
    });
    return [];
  }
}

export type ActivationLinkOutcome =
  | { ok: true; url: string; expiresAt: string; message: string }
  | { ok: false; message: string; url?: string; expiresAt?: string };

interface IntentRow {
  id: string;
  email_normalized: string;
  plan: string;
  status: string;
}

async function readIntent(intentId: string): Promise<IntentRow | null> {
  const rows = await query<IntentRow>(
    `select id::text as id, email_normalized, plan, status
     from member_signup_intent
     where id = $1::uuid`,
    [intentId],
  );

  return rows[0] ?? null;
}

function planName(plan: string): string {
  return isMemberPlanId(plan) ? MEMBER_PLANS[plan].name : "Wands membership";
}

/** Replaces any live link and returns the new one in plain text, once. */
async function mintLink(
  intentId: string,
): Promise<{ url: string; expiresAt: string } | null> {
  await revokeLiveActivationTokens(intentId);

  const issued = await issueActivationToken(intentId);
  if (!issued) return null;

  return {
    url: activationUrl(issued.token, siteUrl),
    expiresAt: issued.expiresAt.toISOString(),
  };
}

type Guarded =
  | { ok: true; intent: IntentRow }
  | { ok: false; message: string };

/**
 * The checks every link action shares.
 *
 * An intent that is already activated is refused rather than re-linked: the
 * account exists, and a fresh link would be a second way in for an address
 * that already has one.
 */
async function guardIntent(intentId: string): Promise<Guarded> {
  if (!isDatabaseConfigured()) {
    return { ok: false, message: "The database is not configured on this deployment." };
  }

  if (!UUID_PATTERN.test(intentId)) {
    return { ok: false, message: "That signup reference is not valid." };
  }

  const intent = await readIntent(intentId);
  if (!intent) {
    return { ok: false, message: "That signup no longer exists." };
  }

  if (intent.status === "activated") {
    return {
      ok: false,
      message: `${intent.email_normalized} has already activated this account.`,
    };
  }

  if (intent.status !== "paid") {
    return {
      ok: false,
      message: `Only a paid signup can be activated. This one is ${intent.status}.`,
    };
  }

  return { ok: true, intent };
}

export async function issueActivationLink({
  intentId,
  actor,
}: {
  intentId: string;
  actor: string;
}): Promise<ActivationLinkOutcome> {
  const guard = await guardIntent(intentId);
  if (!guard.ok) return { ok: false, message: guard.message };

  const link = await mintLink(guard.intent.id);
  if (!link) {
    return { ok: false, message: "The activation link could not be created." };
  }

  await recordAdminAction({
    actor,
    action: "activation.link_issued",
    target: guard.intent.id,
    detail: { plan: guard.intent.plan, expiresAt: link.expiresAt },
  });

  return {
    ok: true,
    url: link.url,
    expiresAt: link.expiresAt,
    message: `A new activation link for ${guard.intent.email_normalized} is ready. Any earlier link has stopped working.`,
  };
}

export async function emailActivationLink({
  intentId,
  actor,
}: {
  intentId: string;
  actor: string;
}): Promise<ActivationLinkOutcome> {
  const guard = await guardIntent(intentId);
  if (!guard.ok) return { ok: false, message: guard.message };

  const link = await mintLink(guard.intent.id);
  if (!link) {
    return { ok: false, message: "The activation link could not be created." };
  }

  if (!emailDeliveryConfigured) {
    return {
      ok: false,
      message:
        "Email delivery is not configured, so nothing was sent. Copy the link and pass it to the customer directly.",
      url: link.url,
      expiresAt: link.expiresAt,
    };
  }

  const message = activationEmail(link.url, planName(guard.intent.plan));
  const result = await sendTransactionalEmail({
    to: guard.intent.email_normalized,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  await recordAdminAction({
    actor,
    action: "activation.link_emailed",
    target: guard.intent.id,
    detail: { plan: guard.intent.plan, delivered: result.delivered },
  });

  if (!result.delivered) {
    return {
      ok: false,
      message:
        "The email provider refused the message. Copy the link and pass it to the customer directly.",
      url: link.url,
      expiresAt: link.expiresAt,
    };
  }

  return {
    ok: true,
    url: link.url,
    expiresAt: link.expiresAt,
    message: `A new activation link was emailed to ${guard.intent.email_normalized}. Any earlier link has stopped working.`,
  };
}

export async function revokeActivationLinks({
  intentId,
  actor,
}: {
  intentId: string;
  actor: string;
}): Promise<{ ok: boolean; message: string }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, message: "The database is not configured on this deployment." };
  }

  if (!UUID_PATTERN.test(intentId)) {
    return { ok: false, message: "That signup reference is not valid." };
  }

  const revoked = await revokeLiveActivationTokens(intentId);
  if (revoked === 0) {
    return { ok: false, message: "There was no live activation link to revoke." };
  }

  await recordAdminAction({
    actor,
    action: "activation.link_revoked",
    target: intentId,
    detail: { revoked },
  });

  return {
    ok: true,
    message:
      revoked === 1
        ? "The live activation link was revoked. It no longer works."
        : `${revoked} live activation links were revoked. They no longer work.`,
  };
}
