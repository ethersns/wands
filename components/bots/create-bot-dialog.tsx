"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

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
  BrokerAccount,
  MarketType,
  Strategy,
  TradingMode,
} from "@/lib/api/contracts";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

interface FormState {
  name: string;
  marketType: MarketType;
  accountId: string;
  strategyId: string;
  symbols: string;
  timeframe: string;
  mode: TradingMode;
  allocatedCapital: string;
  positionSizePct: string;
  stopLossPct: string;
  takeProfitPct: string;
  maxOpenPositions: string;
  dailyLossLimitPct: string;
  schedule: string;
}

const initialState: FormState = {
  name: "",
  marketType: "crypto",
  accountId: "",
  strategyId: "",
  symbols: "",
  timeframe: "1h",
  mode: "paper",
  allocatedCapital: "10000",
  positionSizePct: "10",
  stopLossPct: "3",
  takeProfitPct: "9",
  maxOpenPositions: "1",
  dailyLossLimitPct: "2",
  schedule: "24/7",
};

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground/80">{hint}</p>
      ) : null}
    </div>
  );
}

export function CreateBotDialog({
  accounts,
  strategies,
}: {
  accounts: BrokerAccount[];
  strategies: Strategy[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(initialState);

  const eligibleAccounts = accounts.filter(
    (account) => account.marketType === form.marketType,
  );
  const eligibleStrategies = strategies.filter((strategy) =>
    strategy.supportedMarkets.includes(form.marketType),
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    const result = await engineMutation<{ id: string }>("bots", {
      method: "POST",
      body: {
        name: form.name.trim(),
        marketType: form.marketType,
        accountId: form.accountId,
        strategyId: form.strategyId,
        symbols: form.symbols
          .split(",")
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean),
        timeframe: form.timeframe,
        mode: form.mode,
        allocatedCapital: Number(form.allocatedCapital),
        positionSizePct: Number(form.positionSizePct),
        stopLossPct: Number(form.stopLossPct),
        takeProfitPct: Number(form.takeProfitPct),
        maxOpenPositions: Number(form.maxOpenPositions),
        dailyLossLimitPct: Number(form.dailyLossLimitPct),
        schedule: form.schedule.trim(),
      },
    });

    setPending(false);

    if (!result.ok) {
      toast.error("Bot not created", {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    toast.success("Bot created", {
      description: `${form.name} is configured and stopped. Start it when ready.`,
    });
    setOpen(false);
    setForm(initialState);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" aria-hidden />
          New bot
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a trading bot</DialogTitle>
          <DialogDescription>
            Bots are created stopped. Nothing is executed until you start them and
            the engine confirms the request.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="grid max-h-[60dvh] grid-cols-1 gap-3 overflow-y-auto px-5 pb-4 sm:grid-cols-2">
            <Field label="Bot name" htmlFor="bot-name">
              <Input
                id="bot-name"
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="BTC Trend Core"
                required
                maxLength={60}
              />
            </Field>

            <Field label="Market" htmlFor="bot-market">
              <Select
                value={form.marketType}
                onValueChange={(value) => {
                  update("marketType", value as MarketType);
                  update("accountId", "");
                  update("strategyId", "");
                }}
              >
                <SelectTrigger id="bot-market">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="stocks">Stocks &amp; ETFs</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Account" htmlFor="bot-account">
              <Select
                value={form.accountId}
                onValueChange={(value) => update("accountId", value)}
              >
                <SelectTrigger id="bot-account">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleAccounts.length === 0 ? (
                    <SelectItem value="none" disabled>
                      No account for this market
                    </SelectItem>
                  ) : (
                    eligibleAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Strategy" htmlFor="bot-strategy">
              <Select
                value={form.strategyId}
                onValueChange={(value) => update("strategyId", value)}
              >
                <SelectTrigger id="bot-strategy">
                  <SelectValue placeholder="Select a strategy" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleStrategies.map((strategy) => (
                    <SelectItem key={strategy.id} value={strategy.id}>
                      {strategy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Symbols"
              htmlFor="bot-symbols"
              hint="Comma separated, e.g. BTC/USD, ETH/USD"
            >
              <Input
                id="bot-symbols"
                value={form.symbols}
                onChange={(event) => update("symbols", event.target.value)}
                placeholder="BTC/USD"
                required
                className="font-mono"
              />
            </Field>

            <Field label="Timeframe" htmlFor="bot-timeframe">
              <Select
                value={form.timeframe}
                onValueChange={(value) => update("timeframe", value)}
              >
                <SelectTrigger id="bot-timeframe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((timeframe) => (
                    <SelectItem key={timeframe} value={timeframe}>
                      {timeframe}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Trading mode" htmlFor="bot-mode">
              <Select
                value={form.mode}
                onValueChange={(value) => update("mode", value as TradingMode)}
              >
                <SelectTrigger id="bot-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="backtest">Backtest</SelectItem>
                  <SelectItem value="paper">Paper</SelectItem>
                  <SelectItem value="live" disabled>
                    Live — requires engine authorisation
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Allocated capital" htmlFor="bot-capital">
              <Input
                id="bot-capital"
                type="number"
                min={0}
                step={100}
                value={form.allocatedCapital}
                onChange={(event) => update("allocatedCapital", event.target.value)}
                className="font-mono"
              />
            </Field>

            <Field label="Position size (%)" htmlFor="bot-size">
              <Input
                id="bot-size"
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={form.positionSizePct}
                onChange={(event) => update("positionSizePct", event.target.value)}
                className="font-mono"
              />
            </Field>

            <Field label="Stop loss (%)" htmlFor="bot-stop">
              <Input
                id="bot-stop"
                type="number"
                min={0.1}
                max={50}
                step={0.1}
                value={form.stopLossPct}
                onChange={(event) => update("stopLossPct", event.target.value)}
                className="font-mono"
              />
            </Field>

            <Field label="Take profit (%)" htmlFor="bot-take">
              <Input
                id="bot-take"
                type="number"
                min={0.1}
                max={200}
                step={0.1}
                value={form.takeProfitPct}
                onChange={(event) => update("takeProfitPct", event.target.value)}
                className="font-mono"
              />
            </Field>

            <Field label="Max open positions" htmlFor="bot-max">
              <Input
                id="bot-max"
                type="number"
                min={1}
                max={50}
                step={1}
                value={form.maxOpenPositions}
                onChange={(event) => update("maxOpenPositions", event.target.value)}
                className="font-mono"
              />
            </Field>

            <Field label="Daily loss limit (%)" htmlFor="bot-daily">
              <Input
                id="bot-daily"
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={form.dailyLossLimitPct}
                onChange={(event) => update("dailyLossLimitPct", event.target.value)}
                className="font-mono"
              />
            </Field>

            <Field label="Schedule" htmlFor="bot-schedule">
              <Input
                id="bot-schedule"
                value={form.schedule}
                onChange={(event) => update("schedule", event.target.value)}
                placeholder="24/7"
              />
            </Field>
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
              {pending ? "Creating…" : "Create bot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
