"use client";

import * as React from "react";
import { FlaskConical, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { engineMutation } from "@/lib/api/browser";
import type { Strategy, StrategyParameter } from "@/lib/api/contracts";
import { formatRelative, titleCase } from "@/lib/format";

type Values = Record<string, number | string | boolean>;

function initialValues(strategy: Strategy): Values {
  return Object.fromEntries(
    strategy.parameters.map((parameter) => [parameter.key, parameter.value]),
  );
}

function ParameterControl({
  parameter,
  value,
  onChange,
}: {
  parameter: StrategyParameter;
  value: number | string | boolean;
  onChange: (next: number | string | boolean) => void;
}) {
  const id = `param-${parameter.key}`;

  if (parameter.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <div className="min-w-0">
          <Label htmlFor={id} className="text-foreground">
            {parameter.label}
          </Label>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {parameter.help}
          </p>
        </div>
        <Switch
          id={id}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }

  if (parameter.type === "select") {
    return (
      <div className="flex flex-col gap-1.5 py-1.5">
        <Label htmlFor={id} className="text-foreground">
          {parameter.label}
        </Label>
        <Select value={String(value)} onValueChange={(next) => onChange(next)}>
          <SelectTrigger id={id} className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {parameter.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {parameter.help}
        </p>
      </div>
    );
  }

  const numeric = Number(value);
  const min = parameter.min ?? 0;
  const max = parameter.max ?? 100;
  const step = parameter.step ?? 1;

  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-foreground">
          {parameter.label}
        </Label>
        <span className="font-mono text-[11px] tabular text-foreground">
          {numeric}
          {parameter.type === "percent" ? "%" : ""}
        </span>
      </div>
      <Slider
        id={id}
        value={[numeric]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
        aria-label={parameter.label}
      />
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {parameter.help}
      </p>
    </div>
  );
}

export function StrategyCard({ strategy }: { strategy: Strategy }) {
  const [values, setValues] = React.useState<Values>(() => initialValues(strategy));
  const [pending, setPending] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  const dirty = strategy.parameters.some(
    (parameter) => values[parameter.key] !== parameter.value,
  );

  async function runBacktest() {
    setPending(true);
    const result = await engineMutation<{ id: string }>("backtests", {
      method: "POST",
      body: { strategyId: strategy.id, parameters: values },
    });
    setPending(false);

    if (!result.ok) {
      toast.error("Backtest not started", {
        description: result.error.message,
        duration: 9_000,
      });
      return;
    }

    toast.success("Backtest queued", {
      description: "Results will appear in the Backtests tab when the engine finishes.",
    });
  }

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[13px] font-medium text-foreground">
              {strategy.name}
            </h3>
            <StatusChip label={titleCase(strategy.category)} tone="muted" />
            {strategy.deployment === "paper_only" ? (
              <StatusChip label="Paper only" tone="primary" />
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-pretty text-muted-foreground">
            {strategy.description}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1 px-4">
        {strategy.supportedMarkets.map((market) => (
          <span
            key={market}
            className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {market}
          </span>
        ))}
        <span className="font-mono text-[10px] text-muted-foreground/70">
          updated {formatRelative(strategy.updatedAt)}
        </span>
      </div>

      <div className="mt-3 border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="text-[11px] font-medium text-foreground">
            Parameters
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
              {strategy.parameters.length}
            </span>
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {expanded ? "hide" : "edit"}
          </span>
        </button>

        {expanded ? (
          <div className="mt-2 flex flex-col divide-y divide-border">
            {strategy.parameters.map((parameter) => (
              <ParameterControl
                key={parameter.key}
                parameter={parameter}
                value={values[parameter.key]}
                onChange={(next) =>
                  setValues((current) => ({ ...current, [parameter.key]: next }))
                }
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
        <Button size="sm" onClick={() => void runBacktest()} disabled={pending}>
          <FlaskConical className="size-3" aria-hidden />
          {pending ? "Queueing…" : "Run backtest"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty}
          onClick={() => setValues(initialValues(strategy))}
        >
          <RotateCcw className="size-3" aria-hidden />
          Reset
        </Button>
        {strategy.deployment === "paper_only" ? (
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Lock className="size-2.5" aria-hidden />
            no live deploy
          </span>
        ) : null}
      </div>
    </article>
  );
}
