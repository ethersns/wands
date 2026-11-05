"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { engineMutation } from "@/lib/api/browser";
import type { RiskPolicy, RiskSnapshot } from "@/lib/api/contracts";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

function UtilisationBar({
  label,
  current,
  limit,
  detail,
}: {
  label: string;
  current: number | null;
  limit: number;
  detail?: string;
}) {
  const ratio = current === null ? 0 : Math.min((current / limit) * 100, 100);
  const tone =
    current === null
      ? "bg-muted-foreground/40"
      : ratio >= 90
        ? "bg-loss"
        : ratio >= 70
          ? "bg-primary"
          : "bg-profit";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[11px] tabular text-foreground">
          {formatPercent(current, { digits: 1 })}
          <span className="text-muted-foreground"> / {limit}%</span>
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
        role="meter"
        aria-valuenow={current ?? 0}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={label}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone)}
          style={{ width: `${ratio}%` }}
        />
      </div>
      {detail ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground/80">{detail}</p>
      ) : null}
    </div>
  );
}

const POLICY_FIELDS: {
  key: keyof RiskPolicy;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
}[] = [
  { key: "maxPortfolioExposurePct", label: "Max portfolio exposure", min: 10, max: 100, step: 1, help: "Total invested capital as a share of equity." },
  { key: "maxPositionExposurePct", label: "Max per-position exposure", min: 1, max: 50, step: 0.5, help: "Largest single position as a share of equity." },
  { key: "perTradeRiskPct", label: "Per-trade risk budget", min: 0.1, max: 5, step: 0.05, help: "Equity risked on a single entry." },
  { key: "dailyLossLimitPct", label: "Daily loss circuit breaker", min: 0.5, max: 10, step: 0.1, help: "Trading halts for the day beyond this loss." },
  { key: "maxDrawdownPct", label: "Max drawdown threshold", min: 2, max: 40, step: 0.5, help: "Peak-to-trough loss that halts all bots." },
  { key: "cryptoAllocationCapPct", label: "Crypto allocation cap", min: 0, max: 100, step: 1, help: "Upper bound on crypto exposure." },
  { key: "stocksAllocationCapPct", label: "Stocks allocation cap", min: 0, max: 100, step: 1, help: "Upper bound on equity exposure." },
  { key: "maxQuoteAgeSeconds", label: "Max quote age (s)", min: 5, max: 900, step: 5, help: "Quotes older than this are treated as stale." },
  { key: "duplicateOrderWindowSeconds", label: "Duplicate order window (s)", min: 1, max: 300, step: 1, help: "Identical intents inside this window are rejected." },
];

export function RiskView({ risk }: { risk: RiskSnapshot }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<RiskPolicy>(risk.policy);
  const [saving, setSaving] = React.useState(false);
  const [pausing, setPausing] = React.useState(false);

  const dirty = POLICY_FIELDS.some(
    (field) => draft[field.key] !== risk.policy[field.key],
  );

  async function savePolicy() {
    setSaving(true);
    const result = await engineMutation<RiskPolicy>("risk/policy", {
      method: "PATCH",
      body: draft,
    });
    setSaving(false);

    if (!result.ok) {
      toast.error("Policy not saved", {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    toast.success("Risk policy updated");
    router.refresh();
  }

  async function setPaused(paused: boolean) {
    setPausing(true);
    const result = await engineMutation<{ tradingPaused: boolean }>("risk/pause", {
      method: "POST",
      body: { paused },
    });
    setPausing(false);

    if (!result.ok) {
      toast.error(paused ? "Pause not applied" : "Resume not applied", {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    toast.success(paused ? "Trading paused" : "Trading resumed");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Limit utilisation"
          description="Current exposure against each configured limit"
          bodyClassName="flex flex-col gap-3.5"
        >
          <UtilisationBar
            label="Portfolio exposure"
            current={risk.utilisation.portfolioExposurePct}
            limit={risk.policy.maxPortfolioExposurePct}
          />
          <UtilisationBar
            label="Largest position"
            current={risk.utilisation.largestPositionPct}
            limit={risk.policy.maxPositionExposurePct}
          />
          <UtilisationBar
            label="Daily loss"
            current={risk.utilisation.dailyLossPct}
            limit={risk.policy.dailyLossLimitPct}
            detail="Resets at 00:00 UTC."
          />
          <UtilisationBar
            label="Drawdown"
            current={risk.utilisation.drawdownPct}
            limit={risk.policy.maxDrawdownPct}
          />
          <UtilisationBar
            label="Crypto allocation"
            current={risk.utilisation.cryptoAllocationPct}
            limit={risk.policy.cryptoAllocationCapPct}
          />
          <UtilisationBar
            label="Stocks allocation"
            current={risk.utilisation.stocksAllocationPct}
            limit={risk.policy.stocksAllocationCapPct}
          />
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard
            title="Circuit breakers"
            description="Operator controls that stop execution immediately"
            bodyClassName="flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface/60 p-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-foreground">
                  Pause all trading
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Blocks new trade intents. Existing positions stay open.
                </p>
              </div>
              <Switch
                checked={risk.policy.tradingPaused}
                disabled={pausing}
                onCheckedChange={(checked) => void setPaused(checked)}
                aria-label="Pause all trading"
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface/60 p-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-foreground">
                  Emergency stop
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Halts every bot and cancels resting orders. Requires confirmation
                  from the top bar.
                </p>
              </div>
              <StatusChip
                label={risk.policy.emergencyStopEngaged ? "Engaged" : "Armed"}
                tone={risk.policy.emergencyStopEngaged ? "loss" : "profit"}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface/60 p-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-foreground">
                  Stale market data protection
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Instruments with quotes older than{" "}
                  {risk.policy.maxQuoteAgeSeconds}s are excluded from strategies.
                </p>
              </div>
              <StatusChip label="Enforced" tone="profit" />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface/60 p-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-foreground">
                  Duplicate order protection
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Identical intents within {risk.policy.duplicateOrderWindowSeconds}s
                  are rejected by the engine.
                </p>
              </div>
              <StatusChip label="Enforced" tone="profit" />
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Risk policy"
        description="Changes are applied by the engine, not the browser"
        action={
          <Button
            size="sm"
            onClick={() => void savePolicy()}
            disabled={!dirty || saving}
          >
            <Save className="size-3.5" aria-hidden />
            {saving ? "Saving…" : "Save policy"}
          </Button>
        }
        bodyClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {POLICY_FIELDS.map((field) => {
          const value = Number(draft[field.key]);
          return (
            <div key={field.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={`policy-${field.key}`} className="text-foreground">
                  {field.label}
                </Label>
                <span className="font-mono text-[11px] tabular text-foreground">
                  {value}
                </span>
              </div>
              <Slider
                id={`policy-${field.key}`}
                value={[value]}
                min={field.min}
                max={field.max}
                step={field.step}
                onValueChange={([next]) =>
                  setDraft((current) => ({ ...current, [field.key]: next }))
                }
                aria-label={field.label}
              />
              <p className="text-[10px] leading-relaxed text-muted-foreground/80">
                {field.help}
              </p>
            </div>
          );
        })}
      </SectionCard>
    </div>
  );
}
