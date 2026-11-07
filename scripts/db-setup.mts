import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { memberAuth } from "../lib/auth/member";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const { runMigrations } = await getMigrations(memberAuth.options);
await runMigrations();
console.log("[wands] better-auth tables ready");

const sql = await readFile(new URL("../db/migrations/0001_member_workspace.sql", import.meta.url), "utf8");
await pool.query(sql);
console.log("[wands] member workspace tables ready");

await pool.end();
