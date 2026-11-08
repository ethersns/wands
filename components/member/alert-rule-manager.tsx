"use client";

import { useId, useState } from "react";
import useSWR from "swr";
import { BellRing, Plus, Trash2 } from "lucide-react";

import {
  ALERT_RULE_KINDS,
  ALERT_RULE_KIND_LABEL,
  type AlertRule,
  type AlertRuleKind,
  type RuleOutcome,
} from "@/lib/member/alert-rules";
import { fetcher, sendJson } from "@/lib/member/fetcher";
import { SYMBOL_PATTERN } from "@/lib/member/validation";
import { cn } from "@/lib/utils";
import { Badge, EmptyState } from "./ui";

type Payload = { rules: AlertRule[]; limits: { used: number; max: number } };

type Sweep = {
  evaluated: number;
  created: number;
  alreadyReported: number;
  outcomes: RuleOutcome[];
  notes: string[];
};

const FIELD =
  "w-full rounded-lg border border-mk-line bg-mk-surface px-3 py-2 text-sm text-mk-fg placeholder:text-mk-dim focus:border-mk-accent/60 focus:outline-none focus:ring-2 focus:ring-mk-accent/20";

function usd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function describeRule(rule: AlertRule): string {
  const scope = rule.symbol === null ? "any symbol on your watchlist" : rule.symbol;

  if (rule.kind === "signal") {
    return rule.minScore === null
      ? `Any research signal for ${scope}.`
      : `A research signal for ${scope} scoring ${rule.minScore} or higher.`;
  }

  const action = rule.kind === "insider_purchase" ? "Open-market insider purchase" : "Open-market insider sale";
  return rule.minValue === null
    ? `${action} in ${scope}, at any reported value.`
    : `${action} in ${scope} worth ${usd(rule.minValue)} or more.`;
}

export function AlertRuleManager({
  initial,
  planLabel,
  trackedCount,
}: {
  initial: Payload;
  planLabel: string;
  trackedCount: number;
}) {
  const { data, mutate, error } = useSWR<Payload>("/api/member/alerts", fetcher, { fallbackData: initial });

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sweep, setSweep] = useState<Sweep | null>(null);

  const [kind, setKind] = useState<AlertRuleKind>("insider_purchase");
  const [symbol, setSymbol] = useState("");
  const [threshold, setThreshold] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const kindId = useId();
  const symbolId = useId();
  const thresholdId = useId();

  const rules = data?.rules ?? [];
  const limits = data?.limits ?? initial.limits;
  const atLimit = limits.used >= limits.max;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      // The last sweep described the rule set as it was. Once a rule is added,
      // switched off or deleted, that report is about rules that no longer
      // exist, so it is dropped rather than left to contradict the list.
      setSweep(null);
      await mutate();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function createRule(event: React.FormEvent) {
    event.preventDefault();
    const ticker = symbol.trim().toUpperCase();

    if (ticker && !SYMBOL_PATTERN.test(ticker)) {
      setFormError("Enter a ticker like NVDA or BRK.B, or leave it blank to watch your whole watchlist.");
      return;
    }

    const body: Record<string, unknown> = { kind, symbol: ticker || null };

    if (threshold.trim()) {
      const parsed = Number(threshold);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFormError("Enter a threshold of zero or more.");
        return;
      }
      if (kind === "signal") body.minScore = Math.round(parsed);
      else body.minValue = parsed;
    }

    setFormError(null);
    await run(async () => {
      await sendJson("/api/member/alerts", "POST", body);
      setSymbol("");
      setThreshold("");
    });
  }

  async function checkNow() {
    setBusy(true);
    setActionError(null);
    try {
      const result = await sendJson<{ sweep: Sweep }>("/api/member/alerts/run", "POST");
      setSweep(result.sweep);
      await mutate();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const quiet = sweep?.outcomes.filter((outcome) => outcome.matched === 0) ?? [];

  return (
    <div className="flex flex-col gap-5">
      {actionError ? (
        <p role="alert" className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
          {actionError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
          {error.message}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-mk-line bg-mk-surface/60">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-mk-line px-4 py-3">
          <div>
            <h2 className="font-marketing-mono text-[11px] uppercase tracking-[0.16em] text-mk-muted">
              Check your rules
            </h2>
            <p className="mt-1 text-xs text-mk-dim">
              Runs every enabled rule once against the research engine and writes what it finds to your notifications.
            </p>
          </div>
          <button
            type="button"
            onClick={checkNow}
            disabled={busy || rules.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <BellRing className="size-4" aria-hidden />
            Check now
          </button>
        </header>

        <div className="p-4">
          {sweep === null ? (
            <p className="text-sm text-mk-muted">
              Nothing has been checked in this session. Alerts are not delivered by email, so a check is what turns a
              rule into a notification.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={sweep.created > 0 ? "emerald" : "neutral"}>
                  {sweep.created} new {sweep.created === 1 ? "alert" : "alerts"}
                </Badge>
                <span className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                  {sweep.evaluated} {sweep.evaluated === 1 ? "rule" : "rules"} checked
                  {sweep.alreadyReported > 0 ? ` · ${sweep.alreadyReported} already reported` : ""}
                </span>
              </div>

              {sweep.notes.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {sweep.notes.map((note) => (
                    <li key={note} className="text-xs leading-relaxed text-mk-muted text-pretty">
                      {note}
                    </li>
                  ))}
                </ul>
              ) : null}

              {quiet.length > 0 ? (
                <div className="rounded-lg border border-mk-line bg-mk-deep/40 px-3 py-2.5">
                  <p className="font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    Rules that matched nothing
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {quiet.map((outcome) => {
                      const rule = ruleById.get(outcome.ruleId);
                      return (
                        <li key={outcome.ruleId} className="text-xs leading-relaxed text-mk-muted text-pretty">
                          <span className="text-mk-fg">
                            {rule ? describeRule(rule) : "A rule that has since been deleted."}
                          </span>{" "}
                          {outcome.reason ?? "No event matched."}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {rules.length === 0 ? (
        <EmptyState
          title="No alert rules yet"
          description="A rule is a standing question: tell me when an insider buys a ticker I track, or when a research signal scores highly. Add one below."
        />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-mk-line bg-mk-surface/60">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-mk-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-mk-fg">{ALERT_RULE_KIND_LABEL[rule.kind]}</span>
                  <Badge tone={rule.enabled ? "accent" : "neutral"}>{rule.enabled ? "On" : "Off"}</Badge>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-mk-muted text-pretty">{describeRule(rule)}</p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => run(() => sendJson(`/api/member/alerts/${rule.id}`, "PATCH", { enabled: !rule.enabled }))}
                  disabled={busy}
                  aria-pressed={rule.enabled}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50",
                    rule.enabled
                      ? "border-mk-line text-mk-muted hover:border-mk-line-strong hover:text-mk-fg"
                      : "border-mk-accent/40 text-mk-accent hover:bg-mk-accent-soft",
                  )}
                >
                  {rule.enabled ? "Switch off" : "Switch on"}
                </button>
                <button
                  type="button"
                  onClick={() => run(() => sendJson(`/api/member/alerts/${rule.id}`, "DELETE"))}
                  disabled={busy}
                  className="inline-flex size-7 items-center justify-center rounded-md text-mk-muted transition-colors hover:bg-mk-raised hover:text-mk-warn disabled:opacity-50"
                  aria-label={`Delete the rule: ${describeRule(rule)}`}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={createRule} className="flex flex-col gap-3 rounded-xl border border-mk-line bg-mk-surface/60 p-4">
        <h2 className="font-marketing-mono text-[11px] uppercase tracking-[0.16em] text-mk-muted">New rule</h2>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={kindId} className="text-xs text-mk-muted">
              Watch for
            </label>
            <select
              id={kindId}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as AlertRuleKind);
                setThreshold("");
                setFormError(null);
              }}
              className={FIELD}
            >
              {ALERT_RULE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {ALERT_RULE_KIND_LABEL[option]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={symbolId} className="text-xs text-mk-muted">
              Ticker <span className="text-mk-dim">(blank = your watchlist)</span>
            </label>
            <input
              id={symbolId}
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder={trackedCount > 0 ? "Any tracked ticker" : "NVDA"}
              autoComplete="off"
              spellCheck={false}
              maxLength={10}
              className={cn(FIELD, "font-marketing-mono uppercase placeholder:normal-case")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={thresholdId} className="text-xs text-mk-muted">
              {kind === "signal" ? "Minimum score (0-100)" : "Minimum value (USD)"}
            </label>
            <input
              id={thresholdId}
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              inputMode="numeric"
              placeholder={kind === "signal" ? "70" : "250000"}
              className={cn(FIELD, "tabular-nums")}
            />
          </div>
        </div>

        {formError ? (
          <p role="alert" className="text-xs text-mk-warn">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-mk-dim">
            {limits.used} of {limits.max} rules used on the {planLabel} plan.
            {trackedCount === 0 ? " Your watchlist is empty, so a rule with no ticker has nothing to watch." : ""}
          </p>
          <button
            type="submit"
            disabled={busy || atLimit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden />
            Add rule
          </button>
        </div>
      </form>
    </div>
  );
}
