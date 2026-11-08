import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { memberAuth } from "../lib/auth/member";

/**
 * Ordered application migrations.
 *
 * Better Auth owns its own tables and its own bookkeeping, so it is not listed
 * here. Everything in this list is applied once and recorded in
 * `wands_schema_migration`. A re-run is a no-op, and a file whose contents
 * changed after it was applied is refused rather than replayed over a schema
 * that no longer matches it.
 *
 * `0002_admin_control_centre.sql` was missing from this list, so a fresh
 * environment came up without the admin control centre's tables and the
 * founder's dashboard failed on first load. Both files are written with
 * `if not exists`, so the first run against a database that already has them
 * records them without altering a table, an index or a row.
 */
const MIGRATIONS = [
  "0001_member_workspace.sql",
  "0002_admin_control_centre.sql",
  "0003_member_administration.sql",
  "0004_billing_reference_retention.sql",
  "0005_paid_membership.sql",
] as const;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("[wands] DATABASE_URL is not set; refusing to guess a database.");
}

const pool = new Pool({ connectionString });

const { runMigrations } = await getMigrations(memberAuth.options);
await runMigrations();
console.log("[wands] better-auth tables ready");

await pool.query(`
  create table if not exists wands_schema_migration (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )
`);

for (const name of MIGRATIONS) {
  const sql = await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");

  const applied = await pool.query<{ checksum: string }>(
    "select checksum from wands_schema_migration where name = $1",
    [name],
  );

  if (applied.rowCount) {
    if (applied.rows[0].checksum !== checksum) {
      throw new Error(
        `[wands] ${name} is recorded as applied but its contents have changed. ` +
          "Add a new migration instead of editing one that has already run.",
      );
    }
    console.log(`[wands] ${name} already applied`);
    continue;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into wands_schema_migration (name, checksum) values ($1, $2)",
      [name, checksum],
    );
    await client.query("commit");
    console.log(`[wands] applied ${name}`);
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}

await pool.end();
