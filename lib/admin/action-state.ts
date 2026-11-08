/**
 * The shape a control-centre server action returns.
 *
 * Kept in its own module because a `"use server"` file may only export async
 * functions, and both the action and the dialog that renders its result need
 * this type.
 */
export interface ActionState {
  ok: boolean;
  message: string;
}

export const DEFAULT_RETURN_TO = "/dashboard/members";

/**
 * Only a control-centre path is a valid place to send the operator back to.
 *
 * The value arrives in a form field, so it is attacker-controlled in the same
 * way any request body is. Restricting it to `/dashboard` and its segments
 * keeps a crafted submission from turning a successful action into an open
 * redirect off the site.
 */
const RETURN_TO_PATTERN = /^\/dashboard(?:\/[A-Za-z0-9_-]+)*$/;

export function safeReturnTo(value: FormDataEntryValue | null | undefined): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || !RETURN_TO_PATTERN.test(raw)) return DEFAULT_RETURN_TO;
  return raw;
}
