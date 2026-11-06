import { cn } from "@/lib/utils";
import { availabilityLabel, type Availability } from "@/lib/marketing/features";

const styles: Record<Availability, string> = {
  available: "border-mk-accent/25 bg-mk-accent-soft text-mk-accent",
  beta: "border-mk-warn/25 bg-mk-warn/10 text-mk-warn",
  planned: "border-mk-line-strong bg-mk-raised text-mk-dim",
};

export function AvailabilityBadge({
  availability,
  className,
}: {
  availability: Availability;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-marketing-mono text-[10px] font-medium tracking-[0.12em] uppercase",
        styles[availability],
        className,
      )}
    >
      <span
        className={cn(
          "size-1 rounded-full",
          availability === "available" && "bg-mk-accent",
          availability === "beta" && "bg-mk-warn",
          availability === "planned" && "bg-mk-dim",
        )}
        aria-hidden
      />
      {availabilityLabel[availability]}
    </span>
  );
}
