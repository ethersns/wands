import "server-only";

import { query } from "@/lib/db";
import {
  collectMatches,
  type AlertCandidate,
  type AlertRule,
  type AlertRuleKind,
  type RuleOutcome,
} from "./alert-rules";
import { memberResearch } from "./research";
import { createNotification, getPrefs } from "./notifications";
import { listTrackedSymbols } from "./watchlists";

/**
 * Storage and the sweep for member alert rules.
 *
 * The matching itself lives in `./alert-rules.ts` and is pure. This module only
 * reads rules, reads the feeds, and writes the notifications the matcher
 * produced.
 *
 * The sweep is explicit rather than scheduled. There is no cron in this
 * deployment, and the research engine may be unreachable, so a member asks for
 * a check and is told exactly what happened: how many rules ran, how many
 * events matched, and — for every rule that matched nothing — why. A silent
 * zero would be indistinguishable from a broken feature.
 */

type RuleRow = {
  id: string;
  kind: AlertRuleKind;
  symbol: string | null;
  min_value: string | null;
  min_score: number | null;
  enabled: boolean;
  created_at: Date;
};

const RULE_COLUMNS = "id, kind, symbol, min_value, min_score, enabled, created_at";

function toRule(row: RuleRow): AlertRule {
  return {
    id: row.id,
    kind: row.kind,
    symbol: row.symbol,
    // `numeric` arrives as a string from pg. A null floor stays null: it means
    // "no threshold", which is not the same as a threshold of zero.
    minValue: row.min_value === null ? null : Number(row.min_value),
    minScore: row.min_score,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listRules(userId: string): Promise<AlertRule[]> {
  const rows = await query<RuleRow>(
    `select ${RULE_COLUMNS} from member_alert_rule where user_id = $1 order by created_at desc`,
    [userId],
  );
  return rows.map(toRule);
}

export async function countRules(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from member_alert_rule where user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function createRule(
  userId: string,
  input: { kind: AlertRuleKind; symbol: string | null; minValue: number | null; minScore: number | null },
): Promise<AlertRule> {
  const rows = await query<RuleRow>(
    `insert into member_alert_rule (user_id, kind, symbol, min_value, min_score)
     values ($1, $2, $3, $4, $5)
     returning ${RULE_COLUMNS}`,
    [userId, input.kind, input.symbol, input.minValue, input.minScore],
  );
  return toRule(rows[0]);
}

export async function updateRule(
  userId: string,
  ruleId: string,
  patch: { enabled?: boolean; minValue?: number | null; minScore?: number | null },
): Promise<AlertRule | null> {
  const sets: string[] = [];
  const values: unknown[] = [userId, ruleId];

  if (patch.enabled !== undefined) {
    values.push(patch.enabled);
    sets.push(`enabled = $${values.length}`);
  }
  if (patch.minValue !== undefined) {
    values.push(patch.minValue);
    sets.push(`min_value = $${values.length}`);
  }
  if (patch.minScore !== undefined) {
    values.push(patch.minScore);
    sets.push(`min_score = $${values.length}`);
  }

  if (sets.length === 0) return null;

  const rows = await query<RuleRow>(
    `update member_alert_rule set ${sets.join(", ")}, updated_at = now()
     where id = $2 and user_id = $1
     returning ${RULE_COLUMNS}`,
    values,
  );
  return rows[0] ? toRule(rows[0]) : null;
}

export async function deleteRule(userId: string, ruleId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from member_alert_rule where id = $2 and user_id = $1 returning id`,
    [userId, ruleId],
  );
  return rows.length > 0;
}

export type SweepResult = {
  /** Rules that were actually run, after preference and outage filtering. */
  evaluated: number;
  created: number;
  /** Events that matched but had already been reported by an earlier sweep. */
  alreadyReported: number;
  outcomes: RuleOutcome[];
  /** Why a rule was not run at all, or why a feed was empty. */
  notes: string[];
};

const FEED_LIMIT = 100;

export async function runAlertSweep(userId: string): Promise<SweepResult> {
  const [allRules, prefs, trackedSymbols] = await Promise.all([
    listRules(userId),
    getPrefs(userId),
    listTrackedSymbols(userId),
  ]);

  const notes: string[] = [];
  const enabled = allRules.filter((rule) => rule.enabled);

  if (enabled.length === 0) {
    return {
      evaluated: 0,
      created: 0,
      alreadyReported: 0,
      outcomes: [],
      notes: [
        allRules.length === 0
          ? "No alert rule exists yet, so there was nothing to check."
          : "Every alert rule is switched off, so there was nothing to check.",
      ],
    };
  }

  // The four preference toggles on the account page are the master switch for
  // each category. They gated nothing before this sweep existed; now they
  // decide whether a rule runs at all.
  const rules = enabled.filter((rule) => {
    if (rule.kind === "signal") {
      if (!prefs.assetSignals) {
        notes.push("Research-signal rules were skipped because signal alerts are switched off in your preferences.");
        return false;
      }
      return true;
    }
    if (!prefs.insiderActivity) {
      notes.push("Insider rules were skipped because insider-activity alerts are switched off in your preferences.");
      return false;
    }
    return true;
  });

  if (rules.length === 0) {
    return { evaluated: 0, created: 0, alreadyReported: 0, outcomes: [], notes };
  }

  const needsInsiders = rules.some((rule) => rule.kind !== "signal");
  const needsSignals = rules.some((rule) => rule.kind === "signal");

  const [insiderEnvelope, signalEnvelope] = await Promise.all([
    needsInsiders ? memberResearch.insiders({ openMarketOnly: true, limit: FEED_LIMIT }) : null,
    needsSignals ? memberResearch.signals({ limit: FEED_LIMIT }) : null,
  ]);

  // Research has no demo provenance: an unreachable engine returns an empty
  // payload with `unreachable` set. Matching against that would report "no
  // filing matched" for what is really an outage, so the affected rules are
  // held back and told the truth instead.
  const unreachableKinds = new Set<AlertRuleKind>();
  if (insiderEnvelope?.unreachable) {
    unreachableKinds.add("insider_purchase");
    unreachableKinds.add("insider_sale");
    notes.push(
      insiderEnvelope.warnings[0] ?? "The research engine could not be reached, so no filing was checked.",
    );
  }
  if (signalEnvelope?.unreachable) {
    unreachableKinds.add("signal");
    notes.push(
      signalEnvelope.warnings[0] ?? "The research engine could not be reached, so no signal was checked.",
    );
  }

  const runnable = rules.filter((rule) => !unreachableKinds.has(rule.kind));
  const heldBack: RuleOutcome[] = rules
    .filter((rule) => unreachableKinds.has(rule.kind))
    .map((rule) => ({ ruleId: rule.id, matched: 0, reason: "The research engine could not be reached." }));

  if (runnable.length === 0) {
    return { evaluated: 0, created: 0, alreadyReported: 0, outcomes: heldBack, notes };
  }

  if (runnable.some((rule) => rule.symbol === null) && trackedSymbols.length === 0) {
    notes.push(
      "A rule with no ticker watches the symbols on your watchlist, and your watchlist is empty.",
    );
  }

  const { candidates, outcomes } = collectMatches(
    runnable,
    {
      transactions: insiderEnvelope?.unreachable ? [] : (insiderEnvelope?.data.items ?? []),
      signals: signalEnvelope?.unreachable ? [] : (signalEnvelope?.data.items ?? []),
    },
    trackedSymbols,
  );

  const kindByRule = new Map(runnable.map((rule) => [rule.id, rule.kind]));

  let created = 0;
  let alreadyReported = 0;

  for (const { ruleId, candidate } of candidates) {
    const delivered = await deliver(userId, ruleId, kindByRule.get(ruleId) ?? "signal", candidate);
    if (delivered) created += 1;
    else alreadyReported += 1;
  }

  return {
    evaluated: runnable.length,
    created,
    alreadyReported,
    outcomes: [...outcomes, ...heldBack],
    notes,
  };
}

/**
 * Writes one alert, at most once per (rule, event).
 *
 * The delivery row is inserted first and the notification second, so a crash
 * between the two leaves a delivery with no notification rather than a
 * notification that the next sweep would duplicate. The unique key is what
 * makes a re-run a no-op.
 */
async function deliver(
  userId: string,
  ruleId: string,
  kind: AlertRuleKind,
  candidate: AlertCandidate,
): Promise<boolean> {
  const inserted = await query<{ id: string }>(
    `insert into member_alert_delivery (rule_id, user_id, event_key)
     values ($1, $2, $3)
     on conflict (rule_id, event_key) do nothing
     returning id`,
    [ruleId, userId, candidate.eventKey],
  );

  if (inserted.length === 0) return false;

  const notification = await createNotification(userId, {
    kind: `alert:${kind}`,
    title: candidate.title,
    body: candidate.body,
    href: candidate.href,
  });

  await query(`update member_alert_delivery set notification_id = $2 where id = $1`, [
    inserted[0].id,
    notification.id,
  ]);

  return true;
}
