import "server-only";

import { query } from "@/lib/db";

/**
 * Removes the customer account and everything it owns. Member tables cascade
 * from the auth user row, so deleting the user is the single source of truth.
 */
export async function deleteMemberAccount(userId: string): Promise<void> {
  await query(`delete from session where "userId" = $1`, [userId]);
  await query(`delete from account where "userId" = $1`, [userId]);
  await query(`delete from "user" where id = $1`, [userId]);
}
