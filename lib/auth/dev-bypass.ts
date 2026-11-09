/**
 * Explicit, isolated development bypass for the operator gate.
 *
 * The gate used to open itself whenever `NODE_ENV` was not `production`. That
 * conflated "this is not a production build" with "this is not production
 * data", and the two are not the same thing: a development server can be
 * pointed at the production database, and then the affordance meant to save a
 * password locally becomes unauthenticated access to real member records.
 *
 * The bypass is now opt-in and requires the operator to state, in the
 * environment, that the database behind this process is not production. Absent
 * that statement the gate fails closed in every environment, because a process
 * that cannot prove what it is connected to must not assume the best case.
 *
 * Web Crypto and `process.env` only, so middleware can import this on the edge.
 */

export const DEV_BYPASS_ENV = "WANDS_DEV_OPERATOR_BYPASS";
export const DATABASE_ENV_ENV = "WANDS_DATABASE_ENV";

const NON_PRODUCTION_DATABASES = new Set(["development", "test"]);

export type DevBypassReason =
  | "not_requested"
  | "production_build"
  | "database_not_declared_non_production";

export type DevBypassState =
  | { active: true }
  | { active: false; reason: DevBypassReason };

/**
 * Whether the operator gate may be skipped for this process.
 *
 * All three conditions are required, and each one closes a different hole:
 *
 * 1. `WANDS_DEV_OPERATOR_BYPASS=1` — the operator asked for it. Nothing is
 *    skipped by default, so a forgotten variable cannot open a console.
 * 2. `NODE_ENV !== "production"` — a production build never bypasses, whatever
 *    else is set. This is the backstop for a misconfigured deployment.
 * 3. `WANDS_DATABASE_ENV` is `development` or `test` — the operator has
 *    declared the database non-production. This is the condition that would
 *    have prevented the original exposure, where a development server was
 *    reading the production database.
 */
export function devBypassState(): DevBypassState {
  if (process.env[DEV_BYPASS_ENV]?.trim() !== "1") {
    return { active: false, reason: "not_requested" };
  }

  if (process.env.NODE_ENV === "production") {
    return { active: false, reason: "production_build" };
  }

  const databaseEnv = process.env[DATABASE_ENV_ENV]?.trim().toLowerCase();
  if (!databaseEnv || !NON_PRODUCTION_DATABASES.has(databaseEnv)) {
    return { active: false, reason: "database_not_declared_non_production" };
  }

  return { active: true };
}

export function devBypassActive(): boolean {
  return devBypassState().active;
}
