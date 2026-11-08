import { NextResponse } from "next/server";

import { isDatabaseConfigured, query } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/marketing/rate-limit";
import {
  firstIssue,
  isHoneypotFilled,
  normalizeEmail,
  waitlistInput,
} from "@/lib/marketing/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUCCESS_MESSAGE = "You are on the list.";

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "waitlist"), 6, 10 * 60_000);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Too many attempts from this connection. Please try again shortly.",
      },
      {
        status: 429,
        headers: { "retry-after": String(limit.retryAfterSeconds) },
      },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Send the form as JSON." },
      { status: 400 },
    );
  }

  const parsed = waitlistInput.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: firstIssue(parsed.error) },
      { status: 400 },
    );
  }

  const { email, role, source, companyWebsite } = parsed.data;

  // A hidden field only a script would fill. Answer as if it worked so the
  // bot does not learn which field to skip next time.
  if (isHoneypotFilled(companyWebsite)) {
    return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "The waitlist is not accepting signups right now. Please try again later.",
      },
      { status: 503 },
    );
  }

  const referrer = request.headers.get("referer")?.slice(0, 512) ?? null;

  try {
    await query(
      `insert into public.waitlist_signup (email, email_normalized, role, source, referrer)
       values ($1, $2, $3, $4, $5)
       on conflict (email_normalized) do update
         set role = coalesce(excluded.role, public.waitlist_signup.role),
             source = coalesce(excluded.source, public.waitlist_signup.source),
             referrer = coalesce(excluded.referrer, public.waitlist_signup.referrer),
             updated_at = now()`,
      [email, normalizeEmail(email), role ?? null, source ?? null, referrer],
    );
  } catch (cause) {
    console.log(
      "[wands] waitlist signup failed:",
      cause instanceof Error ? cause.message : cause,
    );

    return NextResponse.json(
      {
        ok: false,
        error: "We could not save that just now. Please try again in a moment.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE });
}
