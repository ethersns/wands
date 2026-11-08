"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { safeReturnTo, type ActionState, type ActivationLinkState } from "./action-state";
import {
  emailActivationLink,
  issueActivationLink,
  revokeActivationLinks,
} from "./activation-links";
import { checkOperator } from "./guard";
import {
  deleteMember,
  deleteWaitlistEntry,
  reactivateMember,
  suspendMember,
} from "./member-actions";

/**
 * Server actions for the control centre.
 *
 * Every action re-validates the operator session here. Middleware already
 * refuses an operator path without a session, but a server action is a POST
 * endpoint in its own right and must not rely on the page that rendered the
 * form having been gated.
 *
 * The result is returned rather than thrown, so the dialog can show the exact
 * server outcome — including a refusal such as "this account has a live Stripe
 * subscription" — instead of a generic error.
 */

type ActorResult =
  | { ok: true; actor: string }
  | { ok: false; state: ActionState };

async function resolveActor(): Promise<ActorResult> {
  const check = await checkOperator();

  if (!check.ok) {
    return {
      ok: false,
      state: {
        ok: false,
        message:
          check.reason === "unconfigured"
            ? "The operator gate is not configured on this deployment."
            : "Your operator session has expired. Sign in again to continue.",
      },
    };
  }

  return { ok: true, actor: check.identity.actor };
}

function refreshMemberViews(userId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/members/suspended");
  revalidatePath("/dashboard/members/billing");
  revalidatePath("/dashboard/members/security");
  revalidatePath("/dashboard/activity");
  if (userId) revalidatePath(`/dashboard/members/${userId}`);
}

export async function suspendMemberAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const who = await resolveActor();
  if (!who.ok) return who.state;

  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  const result = await suspendMember({ userId, reason, actor: who.actor });
  refreshMemberViews(userId);

  return { ok: result.ok, message: result.message };
}

export async function reactivateMemberAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const who = await resolveActor();
  if (!who.ok) return who.state;

  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"));

  const result = await reactivateMember({ userId, reason, actor: who.actor });
  refreshMemberViews(userId);

  // A reactivated account is no longer suspended, so it leaves the suspended
  // list and the row that owns this dialog unmounts. A message held in that
  // dialog would vanish with it, so a successful reactivation is reported by
  // redirecting to the same page with the outcome in the URL, where the page
  // renders it above the table. A refusal still returns normally, because the
  // row is still there and the dialog is the right place to explain it.
  if (result.ok && result.changed) {
    const email = typeof result.detail?.email === "string" ? result.detail.email : null;
    const params = new URLSearchParams({ reactivated: email ?? "1" });
    redirect(`${returnTo}?${params.toString()}`);
  }

  return { ok: result.ok, message: result.message };
}

export async function deleteMemberAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const who = await resolveActor();
  if (!who.ok) return who.state;

  const userId = String(formData.get("userId") ?? "");
  const confirmEmail = String(formData.get("confirmEmail") ?? "");

  const result = await deleteMember({ userId, confirmEmail, actor: who.actor });
  refreshMemberViews(userId);

  return { ok: result.ok, message: result.message };
}

/**
 * Mints a replacement activation link and returns it to the operator once.
 *
 * This is the manual path for a paid customer who never received the emailed
 * link. It is deliberately not a "resend": the stored token is a hash, so the
 * original link cannot be recovered, and the only way to hand one over is to
 * replace it.
 */
export async function issueActivationLinkAction(
  _previous: ActivationLinkState | null,
  formData: FormData,
): Promise<ActivationLinkState> {
  const who = await resolveActor();
  if (!who.ok) return who.state;

  const intentId = String(formData.get("intentId") ?? "");

  const result = await issueActivationLink({ intentId, actor: who.actor });
  revalidatePath("/dashboard/members/billing");

  return result;
}

export async function emailActivationLinkAction(
  _previous: ActivationLinkState | null,
  formData: FormData,
): Promise<ActivationLinkState> {
  const who = await resolveActor();
  if (!who.ok) return who.state;

  const intentId = String(formData.get("intentId") ?? "");

  const result = await emailActivationLink({ intentId, actor: who.actor });
  revalidatePath("/dashboard/members/billing");

  return result;
}

export async function revokeActivationLinkAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const who = await resolveActor();
  if (!who.ok) return who.state;

  const intentId = String(formData.get("intentId") ?? "");

  const result = await revokeActivationLinks({ intentId, actor: who.actor });
  revalidatePath("/dashboard/members/billing");

  return result;
}

export async function deleteWaitlistEntryAction(
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const who = await resolveActor();
  if (!who.ok) return who.state;

  const id = String(formData.get("id") ?? "");

  const result = await deleteWaitlistEntry({ id, actor: who.actor });
  revalidatePath("/dashboard/waitlist");
  revalidatePath("/dashboard");

  return { ok: result.ok, message: result.message };
}
