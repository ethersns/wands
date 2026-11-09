import type { QuantForensicFinding, QuantForensics } from "@/lib/api/research-contract";
import { forensicLabel, forensicTone } from "@/lib/member/quant";

import { Badge, EmptyState, Panel } from "./ui";

/**
 * The order a reader needs: what failed, then what the record only asserts, then
 * what could not be checked, then what does not apply. A declaration sits above
 * an unassessable check because it is the more misleading of the two: it looks
 * like a result until the reader is told nothing corroborates it.
 */
const SEVERITY: Record<string, number> = {
  not_verified: 0,
  declared: 1,
  cannot_assess: 2,
  not_applicable: 3,
};

function FindingRow({ finding }: { finding: QuantForensicFinding }) {
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-sm font-medium text-mk-fg text-pretty">{finding.title}</h3>
        <Badge tone={forensicTone(finding.status)}>{forensicLabel(finding.status)}</Badge>
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-mk-muted text-pretty">
        {finding.explanation}
      </p>

      {finding.evidence.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {finding.evidence.map((item) => (
            <li
              key={item}
              className="font-marketing-mono text-[11px] leading-relaxed text-mk-dim text-pretty"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : null}

      {finding.limitation ? (
        <p className="mt-2 text-[11px] leading-relaxed text-mk-dim text-pretty">
          <span className="font-marketing-mono uppercase tracking-[0.12em]">Limit</span>{" "}
          {finding.limitation}
        </p>
      ) : null}
    </li>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
        {label}
      </dt>
      <dd className="mt-0.5 font-marketing-mono text-sm tabular-nums text-mk-fg">{value}</dd>
    </div>
  );
}

/**
 * Whether the evidence behind a recorded experiment supports its result.
 *
 * The panel is deliberately not a score. It separates what the stored record
 * verified from what it could not, because collapsing those into one number is
 * how a research product starts implying a confidence it never measured.
 */
export function QuantForensicsPanel({ forensics }: { forensics: QuantForensics | null | undefined }) {
  if (!forensics) {
    return (
      <Panel title="Research Forensics">
        <EmptyState
          title="No forensic assessment is available"
          description="This experiment was recorded before the evidence behind it could be assessed, or the engine did not return an assessment. Nothing here should be read as a passed check."
        />
      </Panel>
    );
  }

  const verified = forensics.findings.filter((item) => item.status === "verified");
  const unestablished = forensics.findings
    .filter((item) => item.status !== "verified")
    .sort((left, right) => (SEVERITY[left.status] ?? 9) - (SEVERITY[right.status] ?? 9));

  return (
    <Panel
      title="Research Forensics"
      action={
        <Badge tone={forensics.counts.notVerified > 0 ? "warn" : "neutral"}>
          {forensics.counts.verified}/{forensics.counts.total} verified
        </Badge>
      }
    >
      <p className="text-sm leading-relaxed text-mk-fg text-pretty">{forensics.verdict}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-mk-line py-3 sm:grid-cols-5">
        <Count label="Verified" value={forensics.counts.verified} />
        <Count label="Declared" value={forensics.counts.declared ?? 0} />
        <Count label="Not verified" value={forensics.counts.notVerified} />
        <Count label="Cannot assess" value={forensics.counts.cannotAssess} />
        <Count label="Not applicable" value={forensics.counts.notApplicable} />
      </dl>

      {verified.length > 0 ? (
        <div className="mt-4">
          <h3 className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
            What the record verifies
          </h3>
          <ul className="mt-1 flex flex-col divide-y divide-mk-line">
            {verified.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        </div>
      ) : null}

      {unestablished.length > 0 ? (
        <div className="mt-5">
          <h3 className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
            What the record does not establish
          </h3>
          <ul className="mt-1 flex flex-col divide-y divide-mk-line">
            {unestablished.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        </div>
      ) : null}

      {forensics.nextSteps.length > 0 ? (
        <div className="mt-5 rounded-lg border border-mk-line bg-mk-surface/60 px-4 py-3">
          <h3 className="font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
            Next reasonable validation step
          </h3>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-4">
            {forensics.nextSteps.map((step) => (
              <li key={step} className="text-sm leading-relaxed text-mk-muted text-pretty">
                {step}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {forensics.version ? (
        <p className="mt-4 font-marketing-mono text-[10px] uppercase tracking-[0.14em] text-mk-dim">
          Assessment rules v{forensics.version}
        </p>
      ) : null}

      <p className="mt-1.5 text-[11px] leading-relaxed text-mk-dim text-pretty">{forensics.note}</p>
    </Panel>
  );
}
