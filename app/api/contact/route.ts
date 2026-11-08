import { NextResponse } from "next/server";

import { isDatabaseConfigured, query } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/marketing/rate-limit";
import {
  contactInput,
  firstIssue,
  isHoneypotFilled,
  normalizeEmail,
} from "@/lib/marketing/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "contact"), 4, 15 * 60_000);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Too many messages from this connection. Please try again shortly.",
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

  const parsed = contactInput.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: firstIssue(parsed.error) },
      { status: 400 },
    );
  }

  const { name, email, topic, message, companyWebsite } = parsed.data;

  if (isHoneypotFilled(companyWebsite)) {
    return NextResponse.json({ ok: true });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "The contact form is not accepting messages right now. Please try again later.",
      },
      { status: 503 },
    );
  }

  try {
    await query(
      `insert into public.contact_message (name, email, email_normalized, topic, message, source)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        name,
        email,
        normalizeEmail(email),
        topic ?? null,
        message,
        "contact-page",
      ],
    );
  } catch (cause) {
    console.log(
      "[wands] contact message failed:",
      cause instanceof Error ? cause.message : cause,
    );

    return NextResponse.json(
      { ok: false, error: "We could not send that. Please try again shortly." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
