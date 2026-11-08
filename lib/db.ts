import "server-only";

import { Pool, type QueryResultRow } from "pg";

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? null;

const globalForDb = globalThis as typeof globalThis & {
  __wandsPgPool?: Pool;
};

export function isDatabaseConfigured(): boolean {
  return Boolean(connectionString);
}

function getPool(): Pool {
  if (!connectionString) {
    throw new Error("No Postgres connection string is configured.");
  }

  if (!globalForDb.__wandsPgPool) {
    globalForDb.__wandsPgPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: /(^|@)(localhost|127\.0\.0\.1)/.test(connectionString)
        ? undefined
        : { rejectUnauthorized: false },
    });
  }

  return globalForDb.__wandsPgPool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, values);
  return result.rows;
}

/** A query function bound to one connection inside an open transaction. */
export type TransactionQuery = <T extends QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<T[]>;

/**
 * Runs `fn` inside a single transaction on one pooled connection.
 *
 * Account deletion touches eight tables and must be all-or-nothing: a partial
 * delete would leave a member who can still sign in but whose watchlists are
 * gone. Every statement inside `fn` must go through the `tx` argument — a call
 * to the module-level `query` would take a different connection and sit outside
 * the transaction, which is exactly the bug this helper exists to prevent.
 *
 * The transaction is rolled back on any throw, including a deliberate one used
 * to abort a destructive action that failed its precondition.
 */
export async function withTransaction<T>(
  fn: (tx: TransactionQuery) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const tx: TransactionQuery = async (text, values = []) => {
      const result = await client.query(text, values);
      return result.rows;
    };
    const result = await fn(tx);
    await client.query("commit");
    return result;
  } catch (cause) {
    try {
      await client.query("rollback");
    } catch {
      // A failed rollback means the connection is unusable; the pool discards
      // it. The original error is the one worth reporting.
    }
    throw cause;
  } finally {
    client.release();
  }
}
