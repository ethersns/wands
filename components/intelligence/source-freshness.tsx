import { FreshnessIndicator } from "./freshness-indicator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { IntelSourceStatus } from "@/lib/api/contracts";
import { formatDateTime, formatDuration } from "@/lib/format";

/**
 * Per-collector freshness. A collector that has silently stopped shows as stale
 * here rather than looking populated, which is the whole point of the table.
 */
export function SourceFreshnessTable({
  sources,
}: {
  sources: IntelSourceStatus[];
}) {
  if (sources.length === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The engine reported no collectors. Nothing is being collected, which is not
        the same as nothing having happened.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Source</TableHead>
            <TableHead className="whitespace-nowrap">State</TableHead>
            <TableHead className="hidden text-right 2xl:table-cell">Last success</TableHead>
            <TableHead className="hidden text-right 2xl:table-cell">Stale after</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => (
            <TableRow key={source.source}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-mono text-[11px] text-foreground">
                    {source.source}
                  </span>
                  {source.detail ? (
                    <span className="max-w-44 text-[10px] leading-relaxed text-muted-foreground">
                      {source.detail}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <FreshnessIndicator
                  freshness={source.status}
                  ageSeconds={source.ageSeconds}
                  lastSuccessAt={source.lastSuccessAt}
                />
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[10px] tabular text-muted-foreground 2xl:table-cell">
                {source.lastSuccessAt ? formatDateTime(source.lastSuccessAt) : "never"}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[10px] tabular text-muted-foreground 2xl:table-cell">
                {formatDuration(source.staleAfterSeconds)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
