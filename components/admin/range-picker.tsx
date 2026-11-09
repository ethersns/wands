import Link from "next/link";

import { RANGE_PRESETS, type DateRange, type RangePreset } from "@/lib/admin/period";
import { cn } from "@/lib/utils";

const PRESET_LABELS: Record<Exclude<RangePreset, "custom">, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

function hrefFor(
  basePath: string,
  preset: RangePreset,
  extra: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) {
    if (value) search.set(key, value);
  }
  search.set("preset", preset);
  return `${basePath}?${search.toString()}`;
}

/**
 * Date-range control.
 *
 * Presets are plain links and the custom range is a GET form, so the whole
 * control works without JavaScript and every state is a shareable URL.
 */
export function RangePicker({
  range,
  basePath,
  extraParams = {},
}: {
  range: DateRange;
  basePath: string;
  extraParams?: Record<string, string | undefined>;
}) {
  const presets = RANGE_PRESETS.filter(
    (preset): preset is Exclude<RangePreset, "custom"> => preset !== "custom",
  );

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Reporting period" className="flex flex-wrap items-center gap-1">
        {presets.map((preset) => {
          const active = range.preset === preset;
          return (
            <Link
              key={preset}
              href={hrefFor(basePath, preset, extraParams)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {PRESET_LABELS[preset]}
            </Link>
          );
        })}
      </nav>

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-1.5">
        <input type="hidden" name="preset" value="custom" />
        {Object.entries(extraParams).map(([key, value]) =>
          value ? <input key={key} type="hidden" name={key} value={value} /> : null,
        )}

        <div className="flex flex-col gap-0.5">
          <label htmlFor="range-from" className="text-[10px] text-muted-foreground">
            From
          </label>
          <input
            id="range-from"
            type="date"
            name="from"
            defaultValue={range.from}
            className="h-7 rounded-md border border-border bg-surface px-2 font-mono text-[11px] text-foreground"
          />
        </div>

        <div className="flex flex-col gap-0.5">
          <label htmlFor="range-to" className="text-[10px] text-muted-foreground">
            To
          </label>
          <input
            id="range-to"
            type="date"
            name="to"
            defaultValue={range.to}
            className="h-7 rounded-md border border-border bg-surface px-2 font-mono text-[11px] text-foreground"
          />
        </div>

        <button
          type="submit"
          className="h-7 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          Apply
        </button>
      </form>
    </div>
  );
}
