import { betterAuth } from "better-auth";
import { Pool } from "pg";
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
  // A session row is created on every successful sign-in and deleted on
  // sign-out, so it cannot answer "how many people signed in this week". This
  // hook records the durable event. It is additive: the sign-in itself has
  // already succeeded by the time it runs, and `recordSignIn` swallows its own
  // errors, so a logging failure can never block a member.
  databaseHooks: {
    session: {
      create: {
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
