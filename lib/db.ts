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
