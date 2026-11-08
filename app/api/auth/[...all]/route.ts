import { toNextJsHandler } from "better-auth/next-js";

import { memberAuth } from "@/lib/auth/member";
import {
  clientIpFromHeaders,
  hashEmail,
  userAgentFromHeaders,
} from "@/lib/member/request-context";
import { recordSecurityEvent } from "@/lib/member/security-events";

const handler = toNextJsHandler(memberAuth);

export const GET = handler.GET;

/**
 * Sign-in attempts are observed here so a failure can be recorded.
 *
 * Better Auth owns the sign-in endpoint, and a failed attempt never reaches the
 * session hook that records a successful one. Wrapping the handler is the
 * narrowest place to see the outcome without reimplementing authentication.
 *
 * Only the outcome, a salted digest of the attempted address, and the trusted
 * request metadata are recorded. The password is never read, and the body is
 * cloned before inspection so the handler still receives it intact.
 */
export async function POST(request: Request) {
  const isSignIn = new URL(request.url).pathname.endsWith("/sign-in/email");

  let attemptedEmail: string | null = null;

  if (isSignIn) {
    try {
      const body = (await request.clone().json()) as { email?: unknown };
      if (typeof body.email === "string") attemptedEmail = body.email;
    } catch {
      // A malformed body is the handler's problem to reject, not ours.
    }
  }

  const response = await handler.POST(request);

  if (isSignIn && response.status >= 400) {
    await recordSecurityEvent({
      kind: "sign_in_failed",
      outcome: "failure",
      emailHash: attemptedEmail ? hashEmail(attemptedEmail) : null,
      ipAddress: clientIpFromHeaders(request.headers),
      userAgent: userAgentFromHeaders(request.headers),
      detail: { status: response.status },
    });
  }

  return response;
}
