import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { Pool } from "pg";
import { isAccountSuspended } from "@/lib/admin/account-status";
import { emailDeliveryConfigured, passwordResetEmail, sendTransactionalEmail, verificationEmail } from "@/lib/email/send";
import { recordSignIn } from "@/lib/member/login-events";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function resolveBaseURL(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.V0_RUNTIME_URL) return process.env.V0_RUNTIME_URL;
  return "http://localhost:3000";
}

function resolveTrustedOrigins(): string[] {
  const origins = new Set<string>();
  const add = (value?: string) => {
    if (!value) return;
    origins.add(value.startsWith("http") ? value : `https://${value}`);
  };

  if (process.env.NODE_ENV === "development") {
    origins.add("http://localhost:3000");
    add(process.env.V0_RUNTIME_URL);
    add(process.env.V0_DEV_APP_URL);
    add(process.env.V0_BUILD_URL);
    add(process.env.V0_SANDBOX_URL);
  } else {
    add(process.env.VERCEL_URL);
    add(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  }

  return [...origins];
}

export const memberAuth = betterAuth({
  appName: "Wands",
  baseURL: resolveBaseURL(),
  trustedOrigins: resolveTrustedOrigins(),
  database: pool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // Requiring verification without a delivery provider would lock every new
    // account out, so the requirement follows whether email can actually send.
    requireEmailVerification: emailDeliveryConfigured,
    sendResetPassword: async ({ user, url }) => {
      const message = passwordResetEmail(url);
      await sendTransactionalEmail({ to: user.email, ...message });
    },
  },
  emailVerification: {
    sendOnSignUp: emailDeliveryConfigured,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const message = verificationEmail(url);
      await sendTransactionalEmail({ to: user.email, ...message });
    },
  },
  // Two hooks on session creation, and they do different jobs.
  //
  // `before` is the suspension gate. A suspended account must not be able to
  // obtain a session, and this is the only place that can refuse one before it
  // exists — a check in a page or a route would run after the cookie had
  // already been issued. Throwing here aborts the sign-in and Better Auth
  // answers with the status below.
  //
  // `after` records the durable sign-in event. A session row is deleted on
  // sign-out, so it cannot answer "how many people signed in this week". It is
  // additive: the sign-in has already succeeded by the time it runs, and
  // `recordSignIn` swallows its own errors, so a logging failure can never
  // block a member.
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          if (await isAccountSuspended(session.userId)) {
            throw new APIError("FORBIDDEN", {
              message:
                "This account is suspended. Contact support if you believe this is a mistake.",
              code: "ACCOUNT_SUSPENDED",
            });
          }
        },
        after: async (session) => {
          await recordSignIn(session.userId);
        },
      },
    },
  },
  advanced: {
    cookiePrefix: "wands",
    ...(process.env.NODE_ENV === "development"
      ? {
          // Required by the cross-site v0 preview iframe. Without these
          // attributes, login succeeds but the next request appears signed out.
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
          },
        }
      : {}),
  },
});

export type MemberSession = typeof memberAuth.$Infer.Session;
