"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { ModeBadge } from "@/components/shared/mode-badge";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  AccessLevel,
  BrokerAccount,
  Connection,
  Currency,
  TradingMode,
} from "@/lib/api/contracts";
import { formatCurrency, formatRelative, titleCase } from "@/lib/format";
import { connectionStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { value: "kraken", label: "Kraken", market: "Crypto" },
  { value: "alpaca", label: "Alpaca", market: "Stocks & ETFs" },
  { value: "interactive_brokers", label: "Interactive Brokers", market: "Stocks" },
] as const;

function AddConnectionDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [provider, setProvider] = React.useState<string>("kraken");
  const [label, setLabel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [apiSecret, setApiSecret] = React.useState("");
  const [mode, setMode] = React.useState<TradingMode>("paper");
  const [access, setAccess] = React.useState<AccessLevel>("read_only");

  function reset() {
    setLabel("");
    setApiKey("");
    setApiSecret("");
    setMode("paper");
    setAccess("read_only");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    const result = await engineMutation<{ id: string }>("connections", {
      method: "POST",
      body: { provider, label: label.trim(), apiKey, apiSecret, mode, access },
    });

    setPending(false);

    if (!result.ok) {
      toast.error("Connection not created", {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    reset();
    setOpen(false);
    toast.success("Connection created", {
      description: "Credentials were sent once to the engine and are not stored in the browser.",
    });
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" aria-hidden />
          Add connection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect an exchange or broker</DialogTitle>
          <DialogDescription>
            Credentials are posted once to the private engine, which stores them
            encrypted. They are never written to browser storage and never shown
            again after submission.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col">
          <div className="flex flex-col gap-3 px-5 pb-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conn-provider">Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger id="conn-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label} · {item.market}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conn-label">Label</Label>
              <Input
                id="conn-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Kraken · Main"
                required
                maxLength={40}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conn-key">API key</Label>
              <Input
                id="conn-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                className="font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conn-secret">API secret</Label>
              <Input
                id="conn-secret"
                type="password"
                value={apiSecret}
                onChange={(event) => setApiSecret(event.target.value)}
                autoComplete="new-password"
                required
                className="font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="conn-mode">Mode</Label>
                <Select
                  value={mode}
                  onValueChange={(value) => setMode(value as TradingMode)}
                >
                  <SelectTrigger id="conn-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paper">Paper</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="conn-access">Access</Label>
                <Select
                  value={access}
                  onValueChange={(value) => setAccess(value as AccessLevel)}
                >
                  <SelectTrigger id="conn-access">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read_only">Read only</SelectItem>
                    <SelectItem value="trading">Trading</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden />
              Grant only the permissions the engine needs. Read-only keys cannot
              place orders, and live trading stays disabled until it is authorised
              on the engine.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionCard({
  connection,
  account,
  currency,
}: {
  connection: Connection;
  account?: BrokerAccount;
  currency: Currency;
}) {
  const router = useRouter();
  const [testing, setTesting] = React.useState(false);
  const status = connectionStatus(connection.status);

  async function test() {
    setTesting(true);
    const result = await engineMutation<{ status: string }>(
      `connections/${connection.id}/test`,
      { method: "POST" },
    );
    setTesting(false);

    if (!result.ok) {
      toast.error("Connection test failed", {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    toast.success("Connection test passed");
    router.refresh();
  }

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[13px] font-medium text-foreground">
              {connection.label}
            </h3>
            <StatusChip label={status.label} tone={status.tone} />
            <ModeBadge mode={connection.mode} />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {titleCase(connection.provider)} ·{" "}
            {connection.access === "trading" ? "Trading access" : "Read only"}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <KeyRound className="size-2.5" aria-hidden />
          {connection.keyHint ?? "no key"}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 px-4">
        <div>
          <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            Equity
          </dt>
          <dd className="font-mono text-[12px] tabular text-foreground">
            {formatCurrency(account?.equity ?? null, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            Cash
          </dt>
          <dd className="font-mono text-[12px] tabular text-foreground">
            {formatCurrency(account?.cash ?? null, currency)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-1 px-4">
        {connection.permissions.length === 0 ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            no permissions granted
          </span>
        ) : (
          connection.permissions.map((permission) => (
            <span
              key={permission}
              className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {permission}
            </span>
          ))
        )}
      </div>

      {connection.error ? (
        <p className="mt-3 flex items-start gap-1.5 border-t border-loss/20 bg-loss/[0.06] px-4 py-2 text-[11px] leading-relaxed text-loss">
          <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
          {connection.error}
        </p>
      ) : null}

      <div className="mt-auto flex items-center gap-2 border-t border-border px-4 py-2.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void test()}
          disabled={testing || !connection.available}
        >
          <RefreshCw
            className={cn("size-3", testing && "animate-spin")}
            aria-hidden
          />
          {testing ? "Testing…" : "Test"}
        </Button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          synced {formatRelative(connection.lastSyncedAt)}
        </span>
      </div>
    </article>
  );
}

export function ConnectionsView({
  connections,
  accounts,
  currency,
}: {
  connections: Connection[];
  accounts: BrokerAccount[];
  currency: Currency;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {connections.filter((item) => item.status === "connected").length} of{" "}
          {connections.length} connections active
        </p>
        <AddConnectionDialog />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {connections.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            account={accounts.find(
              (account) => account.provider === connection.provider,
            )}
            currency={currency}
          />
        ))}
      </div>
    </div>
  );
}
