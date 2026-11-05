"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/section-card";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { engineMutation } from "@/lib/api/browser";
import type {
  BrokerAccount,
  Currency,
  Envelope,
  PaperAccount,
} from "@/lib/api/contracts";
import { formatCurrency } from "@/lib/format";

const CURRENCIES: Currency[] = ["USD", "EUR", "GBP", "JPY", "AUD", "CHF"];

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-mono text-[12px] tabular text-foreground">{value}</span>
    </div>
  );
}

/**
 * Paper account controls.
 *
 * Initialisation and reset are the only mutations here, and both are paper-only
 * on the server. There is no control that could promote an account to live.
 */
export function PaperAccountPanel({
  accounts,
  connections,
  readOnly = false,
}: {
  accounts: PaperAccount[];
  connections: BrokerAccount[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const paperConnections = connections.filter((account) => account.mode === "paper");
  const [cash, setCash] = React.useState("100000");
  const [currency, setCurrency] = React.useState<Currency>("USD");
  const [busy, setBusy] = React.useState<string | null>(null);

  const byConnection = new Map(
    accounts.map((account) => [account.connectionId, account]),
  );

  async function submit(connectionId: string, reset: boolean) {
    const amount = Number(cash);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive starting cash amount.");
      return;
    }

    setBusy(connectionId);
    const result = await engineMutation<Envelope<PaperAccount>>(
      reset ? `paper/accounts/${connectionId}/reset` : "paper/accounts",
      {
        method: "POST",
        body: reset
          ? { startingCash: amount, currency }
          : { connectionId, startingCash: amount, currency },
      },
    );
    setBusy(null);

    if (!result.ok) {
      toast.error(reset ? "Reset failed" : "Initialisation failed", {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    toast.success(reset ? "Paper account reset" : "Paper account initialised");
    router.refresh();
  }

  if (paperConnections.length === 0) {
    return (
      <SectionCard
        title="Paper account"
        description="Simulated capital for paper trading"
      >
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          No paper connection is configured. Create one on the Connections page
          before initialising simulated capital.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Paper account"
      description="Simulated capital. Never connected to real funds."
      bodyClassName="flex flex-col gap-4"
    >
      {readOnly ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Connect the engine to initialise or reset simulated capital. These
          controls are read-only against demonstration data.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="paper-cash">Starting cash</Label>
          <Input
            id="paper-cash"
            inputMode="decimal"
            value={cash}
            onChange={(event) => setCash(event.target.value)}
            className="h-11 text-[16px] sm:h-9 sm:text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-32">
          <Label htmlFor="paper-currency">Currency</Label>
          <Select
            value={currency}
            onValueChange={(value) => setCurrency(value as Currency)}
          >
            <SelectTrigger id="paper-currency" className="h-11 sm:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border">
        {paperConnections.map((connection) => {
          const account = byConnection.get(connection.id);
          return (
            <div
              key={connection.id}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-foreground">
                    {connection.label}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {connection.provider} · {connection.baseCurrency}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusChip label="Paper" tone="primary" />
                  {account ? (
                    <StatusChip
                      label={account.verified ? "Verified" : "Unverified"}
                      tone={account.verified ? "profit" : "loss"}
                    />
                  ) : null}
                </div>
              </div>

              {account ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Figure
                      label="Cash"
                      value={formatCurrency(account.cash, account.baseCurrency)}
                    />
                    <Figure
                      label="Reserved"
                      value={formatCurrency(account.reserved, account.baseCurrency)}
                    />
                    <Figure
                      label="Buying power"
                      value={formatCurrency(account.buyingPower, account.baseCurrency)}
                    />
                    <Figure
                      label="Equity"
                      value={formatCurrency(account.equity, account.baseCurrency)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 self-start sm:h-8"
                    disabled={readOnly || busy === connection.id}
                    onClick={() => void submit(connection.id, true)}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    {busy === connection.id ? "Resetting…" : "Reset to starting cash"}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="h-11 self-start sm:h-8"
                  disabled={readOnly || busy === connection.id}
                  onClick={() => void submit(connection.id, false)}
                >
                  <FlaskConical className="size-3.5" aria-hidden />
                  {busy === connection.id
                    ? "Initialising…"
                    : "Initialise paper account"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
