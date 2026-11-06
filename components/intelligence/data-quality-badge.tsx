import { cn } from "@/lib/utils";
import { dataQualityLabel, dataQualityTone } from "@/lib/intelligence/presentation";
import { toneChip } from "@/lib/status";

const EXPLANATION: Record<string, string> = {
  reported: "Every required field was present in the source document.",
  derived:
    "Computed by the engine from reported values. The derivation is in the signal's parameters.",
  incomplete:
    "A required field was missing in the source, for example a purchase with no reported price.",
  unavailable: "The engine could not produce this value.",
};

/**
 * Whether a record is as reported, computed, or missing a field. `incomplete`
 * is amber rather than red: the record is usable, but a number in it is absent.
 */
export function DataQualityBadge({
  quality,
  className,
  showLabel = true,
}: {
  quality: string;
  className?: string;
  showLabel?: boolean;
}) {
  return (
    <span
      title={EXPLANATION[quality] ?? quality}
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-[0.04em] whitespace-nowrap uppercase",
        toneChip[dataQualityTone(quality)],
        className,
      )}
    >
      {showLabel ? dataQualityLabel(quality) : <span className="sr-only">{dataQualityLabel(quality)}</span>}
    </span>
  );
}
