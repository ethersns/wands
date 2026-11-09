import "server-only";

import {
  activationEmail,
  emailDeliveryConfigured,
  sendTransactionalEmail,
} from "@/lib/email/send";
import { siteUrl } from "@/lib/marketing/site";

import {
  activationUrl,
  hasLiveActivationToken,
  issueActivationToken,
} from "./activation";
import { MEMBER_PLANS, isMemberPlanId } from "./config";
import { getSignupIntent } from "./signup-intent";

/**
 * Sends the activation link for a paid signup.
 *
 * Called from the webhook, which means it can run more than once for the same
 * payment. It is therefore idempotent in the way that matters: an intent that
 * already has a live token is not issued a second one, so a retried delivery
 * neither invalidates the link the customer already holds nor sends a second
 * email.
 *
 * When no email provider is configured the token is still issued and the
 * outcome says so. The flow is complete; the delivery is the missing piece, and
 * the operator can see the pending activation in the control centre.
 */

export type ActivationDispatch =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "no_intent"
        | "not_paid"
        | "already_activated"
        | "already_issued"
        | "email_unconfigured"
        | "delivery_failed";
    };

export async function dispatchActivation(
  intentId: string,
): Promise<ActivationDispatch> {
  const intent = await getSignupIntent(intentId);

  if (!intent) return { sent: false, reason: "no_intent" };
  if (intent.status === "activated") return { sent: false, reason: "already_activated" };
  if (intent.status !== "paid") return { sent: false, reason: "not_paid" };
  if (await hasLiveActivationToken(intent.id)) {
    return { sent: false, reason: "already_issued" };
  }

  const issued = await issueActivationToken(intent.id);
  if (!issued) return { sent: false, reason: "no_intent" };

  if (!emailDeliveryConfigured) {
    console.warn(
      "[wands] activation link issued but no email provider is configured; the customer cannot self-activate until RESEND_API_KEY is set",
      { intent: intent.id },
    );
    return { sent: false, reason: "email_unconfigured" };
  }

  const planName = isMemberPlanId(intent.plan)
    ? MEMBER_PLANS[intent.plan].name
    : "Wands membership";

  const message = activationEmail(activationUrl(issued.token, siteUrl), planName);
  const result = await sendTransactionalEmail({
    to: intent.email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  return result.delivered ? { sent: true } : { sent: false, reason: "delivery_failed" };
}
