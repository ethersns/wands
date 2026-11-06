"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronsUpDown,
  Filter,
  Radar,
  X,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { SignalBadge } from "./signal-badge";
import { ResearchScore } from "./score-indicator";
import { DataQualityBadge } from "./data-quality-badge";
import { SignalEvidencePanel } from "./evidence-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ResearchSignal } from "@/lib/api/contracts";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  activeFilterCount,
  EMPTY_SIGNAL_FILTERS,
  filterSignals,
  SIGNAL_CATEGORIES,
  signalCategoryLabel,
  sortRows,
  type SignalFilters,
  type SortDirection,
} from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

type SortKey = "symbol" | "score" | "eventTime" | "publicAvailableAt";

const QUALITY_OPTIONS = ["reported", "derived", "incomplete", "unavailable"];

const AVAILABILITY_OPTIONS: { value: SignalFilters["availability"]; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

function sortValue(signal: ResearchSignal, key: SortKey): number | string | null {
  switch (key) {
    case "symbol":
      return signal.symbol;
    case "score":
      return signal.score;
    case "eventTime":
      return signal.eventTime;
    case "publicAvailableAt":
      return signal.publicAvailableAt;
  }
}

function SortHeader({
  label,
  sortKey,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead
      className={className}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 rounded text-[10px] font-medium tracking-[0.06em] uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className="size-2.5" aria-hidden />
      </button>
    </TableHead>
  );
}

/**
 * The signal feed with its filters.
 *
 * `symbol` and `category` are sent to the engine, which pages and filters the
 * feed. The remaining filters narrow the page that came back, and the count
 * line says so rather than implying a global filter.
 */
export function SignalExplorer({
  signals,
  serverFilters,
  basePath,
  total,
  page,
  limit,
}: {
  signals: ResearchSignal[];
  serverFilters: { symbol: string; category: string };
  basePath: string;
  total: number;
  page: number;
  limit: number;
}) {
  const router = useRouter();
  const [local, setLocal] = React.useState<SignalFilters>({
    ...EMPTY_SIGNAL_FILTERS,
    symbol: serverFilters.symbol,
    category: serverFilters.category,
  });
  const [sort, setSort] = React.useState<{ key: SortKey; direction: SortDirection }>({
    key: "publicAvailableAt",
    direction: "desc",
  });
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const visible = React.useMemo(() => {
    const filtered = filterSignals(signals, local);
    return sortRows(filtered, (signal) => sortValue(signal, sort.key), sort.direction);
  }, [signals, local, sort]);

  function applyServerFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = new URLSearchParams();
    if (local.symbol.trim()) search.set("symbol", local.symbol.trim().toUpperCase());
    if (local.category) search.set("category", local.category);
    const query = search.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  function onSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "symbol" ? "asc" : "desc" },
    );
  }

  function reset() {
    setLocal(EMPTY_SIGNAL_FILTERS);
    router.push(basePath);
  }

  const localFilterCount = activeFilterCount({ ...local, symbol: "", category: "" });
  const serverFilterCount = (serverFilters.symbol ? 1 : 0) + (serverFilters.category ? 1 : 0);

  return (
    <div className="flex flex-col">
      <form
        onSubmit={applyServerFilters}
        className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-5"
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="signal-symbol"
              className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              Ticker
            </label>
            <input
              id="signal-symbol"
              name="symbol"
              value={local.symbol}
              onChange={(event) =>
                setLocal((current) => ({ ...current, symbol: event.target.value }))
              }
              placeholder="All symbols"
              autoComplete="off"
              spellCheck={false}
              className="h-7 w-32 rounded-md border border-input bg-surface px-2 font-mono text-[11px] text-foreground uppercase placeholder:normal-case placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="signal-category"
              className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              Signal type
            </label>
            <select
              id="signal-category"
              name="category"
              value={local.category}
              onChange={(event) =>
                setLocal((current) => ({ ...current, category: event.target.value }))
              }
              className="h-7 max-w-52 rounded-md border border-input bg-surface px-2 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <option value="">All categories</option>
              {SIGNAL_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {signalCategoryLabel(category)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="signal-quality"
              className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              Data quality
            </label>
            <select
              id="signal-quality"
              value={local.dataQuality}
              onChange={(event) =>
                setLocal((current) => ({ ...current, dataQuality: event.target.value }))
              }
              className="h-7 rounded-md border border-input bg-surface px-2 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <option value="">Any quality</option>
              {QUALITY_OPTIONS.map((quality) => (
                <option key={quality} value={quality}>
                  {quality}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="signal-availability"
              className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              Available
            </label>
            <select
              id="signal-availability"
              value={local.availability}
              onChange={(event) =>
                setLocal((current) => ({
                  ...current,
                  availability: event.target.value as SignalFilters["availability"],
                }))
              }
              className="h-7 rounded-md border border-input bg-surface px-2 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {AVAILABILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="signal-score"
              className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              Min score{" "}
              <span className="font-mono text-foreground normal-case">
                {local.minScore}
              </span>
            </label>
            <input
              id="signal-score"
              type="range"
              min={0}
              max={100}
              step={5}
              value={local.minScore}
              onChange={(event) =>
                setLocal((current) => ({
                  ...current,
                  minScore: Number(event.target.value),
                }))
              }
              className="h-7 w-28 accent-primary"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Filter className="size-3" aria-hidden />
              Apply
            </button>
            {localFilterCount + serverFilterCount > 0 ? (
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="size-3" aria-hidden />
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Ticker and signal type are filtered by the engine across{" "}
          <span className="font-mono text-foreground">{total}</span> stored signals.
          Score, quality and availability narrow the{" "}
          <span className="font-mono text-foreground">{signals.length}</span> signals
          on this page only.
        </p>
      </form>

      {visible.length === 0 ? (
        <div className="px-4 py-4 sm:px-5">
          <EmptyState
            icon={Radar}
            title={
              signals.length === 0
                ? "No research signals stored"
                : "No signal matches these filters"
            }
            description={
              signals.length === 0
                ? "Signals are only produced when a configured threshold is met, so an empty feed is expected for most symbols. Nothing is shown rather than a placeholder event."
                : `None of the ${signals.length} signals on this page meet the current score, quality or availability filters. Clear the filters to see them.`
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHeader
                  label="Symbol"
                  sortKey="symbol"
                  active={sort.key === "symbol"}
                  direction={sort.direction}
                  onSort={onSort}
                />
                <TableHead>Category</TableHead>
                <SortHeader
                  label="Score"
                  sortKey="score"
                  active={sort.key === "score"}
                  direction={sort.direction}
                  onSort={onSort}
                  className="text-right"
                />
                <TableHead className="hidden text-right 2xl:table-cell">
                  Measurement
                </TableHead>
                <TableHead className="hidden sm:table-cell">Quality</TableHead>
                <SortHeader
                  label="Activity"
                  sortKey="eventTime"
                  active={sort.key === "eventTime"}
                  direction={sort.direction}
                  onSort={onSort}
                  className="hidden 2xl:table-cell"
                />
                <SortHeader
                  label="Public"
                  sortKey="publicAvailableAt"
                  active={sort.key === "publicAvailableAt"}
                  direction={sort.direction}
                  onSort={onSort}
                  className="hidden text-right md:table-cell"
                />
                <TableHead className="text-right">
                  <span className="sr-only">Evidence</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((signal) => {
                const isOpen = expanded === signal.id;
                return (
                  <React.Fragment key={signal.id}>
                    <TableRow className={cn(isOpen && "bg-accent/40")}>
                      <TableCell className="font-mono text-[12px] font-medium text-foreground">
                        {signal.symbol}
                      </TableCell>
                      <TableCell>
                        <SignalBadge category={signal.category} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ResearchScore score={signal.score} className="justify-end" />
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground 2xl:table-cell">
                        {formatNumber(signal.rawMeasurement, { digits: 2 })}
                        <span className="ml-1 text-muted-foreground/70">
                          {signal.rawUnit}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <DataQualityBadge quality={signal.dataQuality} />
                      </TableCell>
                      <TableCell className="hidden font-mono text-[11px] tabular text-muted-foreground 2xl:table-cell">
                        {formatDateTime(signal.eventTime)}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground md:table-cell">
                        {formatDateTime(signal.publicAvailableAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : signal.id)}
                          aria-expanded={isOpen}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {isOpen ? "Hide" : "Evidence"}
                          <span className="sr-only">
                            {" "}
                            for {signal.symbol} {signalCategoryLabel(signal.category)}
                          </span>
                        </button>
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="bg-surface/40 p-3">
                          <SignalEvidencePanel
                            signal={signal}
                            footer={
                              <Link
                                href={`/intelligence/performance?signal=${encodeURIComponent(signal.id)}`}
                                className="inline-flex items-center gap-1 self-start rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              >
                                Measured validation
                                <ArrowRight className="size-2.5" aria-hidden />
                              </Link>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="border-t border-border px-4 py-2 font-mono text-[10px] text-muted-foreground sm:px-5">
        showing {visible.length} of {signals.length} on page {page} · limit {limit}
      </p>
    </div>
  );
}
