import "server-only";

import { isDatabaseConfigured, query, type TransactionQuery } from "@/lib/db";

/**
 * Audit trail for sensitive administrative actions.
 *
 * Only non-sensitive context belongs in `detail`: a filter, a row count, a
 * format. Passwords, session tokens, reset tokens and full exported rows must
 * never reach this table, because an audit log is read by more people than the
 * data it describes.
 *
 * Writing is best-effort. A failed audit insert must not turn a successful
 * export into a 500 for the operator, but it is logged so the gap is visible.
 */
export interface AdminActionInput {
  actor: string;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Writes the audit row on a caller-supplied transaction.
 *
 * A destructive action must not commit without its audit row, so the deletion
 * and the record of who performed it share one transaction. This variant
 * therefore throws: a failure here has to roll the whole action back.
 */
export async function writeAudit(
  tx: TransactionQuery,
  input: AdminActionInput,
): Promise<void> {
  await tx(
    `insert into admin_audit_log (actor, action, target, detail)
     values ($1, $2, $3, $4::jsonb)`,
    [
      input.actor,
      input.action,
      input.target ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}

export async function recordAdminAction(input: AdminActionInput): Promise<void> {
  if (!isDatabaseConfigured()) return;

  try {
    await query(
      `insert into admin_audit_log (actor, action, target, detail)
       values ($1, $2, $3, $4::jsonb)`,
      [
        input.actor,
        input.action,
        input.target ?? null,
        JSON.stringify(input.detail ?? {}),
      ],
    );
  } catch (cause) {
    console.log(
      "[v0] admin audit write failed:",
      cause instanceof Error ? cause.message : cause,
    );
  }
}

export interface AuditEntry {
  id: string;
  occurred_at: string;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
}

export async function recentAdminActions(limit = 20): Promise<AuditEntry[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    return await query<AuditEntry>(
      `select id::text, occurred_at, actor, action, target, detail
       from admin_audit_log
       order by occurred_at desc
       limit $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
  } catch {
    return [];
  }
}
