import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QuantForensicsPanel } from "@/components/member/quant-forensics";
import type { QuantForensics } from "@/lib/api/research-contract";

function finding(
  id: string,
  title: string,
  status: QuantForensics["findings"][number]["status"],
  overrides: Partial<QuantForensics["findings"][number]> = {},
): QuantForensics["findings"][number] {
  return {
    id,
    title,
    status,
    explanation: `${title} explanation.`,
    evidence: [`${title} evidence.`],
    limitation: null,
    nextStep: null,
    ...overrides,
  };
}

const REPORT: QuantForensics = {
  version: "1.0.1",
  findings: [
    finding("recorded_temporal_boundary", "Recorded temporal boundary", "verified"),
    finding("reproducibility_metadata", "Reproducibility metadata", "not_verified", {
      limitation: "A retrospective result is not independent confirmation.",
      nextStep: "Freeze the rule and measure it on a later window.",
    }),
    finding("out_of_sample_independence", "Out-of-sample independence", "declared", {
      limitation: "A held-out label can be attached to a window that was in fact examined.",
      nextStep: "Record the design and evaluation windows separately.",
    }),
    finding("parameter_sensitivity", "Parameter sensitivity", "cannot_assess", {
      nextStep: "Re-run across a parameter grid.",
    }),
    finding("publication_versus_transaction", "Filing publication", "not_applicable"),
  ],
  counts: {
    total: 5,
    verified: 1,
    declared: 1,
    notVerified: 1,
    cannotAssess: 1,
    notApplicable: 1,
  },
  verdict:
    "1 of 5 checks are verified by the stored record. 1 is declared by it but not independently established. 1 is not verified. 1 could not be assessed from it. 1 does not apply to this study.",
  nextSteps: [
    "Freeze the rule and measure it on a later window.",
    "Record the design and evaluation windows separately.",
    "Re-run across a parameter grid.",
  ],
  note: "This assessment reads the stored experiment.",
};

describe("Research Forensics panel", () => {
  it("separates what was verified from what was not established", () => {
    const { container } = render(<QuantForensicsPanel forensics={REPORT} />);
    const text = container.textContent ?? "";

    const verifiedHeading = text.indexOf("What the record verifies");
    const unestablishedHeading = text.indexOf("What the record does not establish");
    const verifiedFinding = text.indexOf("Recorded temporal boundary");
    const unassessableFinding = text.indexOf("Parameter sensitivity");

    expect(verifiedHeading).toBeGreaterThan(-1);
    expect(unestablishedHeading).toBeGreaterThan(verifiedHeading);
    expect(verifiedFinding).toBeGreaterThan(verifiedHeading);
    expect(verifiedFinding).toBeLessThan(unestablishedHeading);
    expect(unassessableFinding).toBeGreaterThan(unestablishedHeading);
  });

  it("orders a declaration above a check that could not be assessed", () => {
    const { container } = render(<QuantForensicsPanel forensics={REPORT} />);
    const text = container.textContent ?? "";

    const failed = text.indexOf("Reproducibility metadata");
    const declared = text.indexOf("Out-of-sample independence");
    const unassessable = text.indexOf("Parameter sensitivity");

    expect(failed).toBeGreaterThan(-1);
    expect(declared).toBeGreaterThan(failed);
    expect(unassessable).toBeGreaterThan(declared);
  });

  it("never renders an unassessable check as verified", () => {
    const { container } = render(<QuantForensicsPanel forensics={REPORT} />);

    // One badge per finding, plus the summary badge in the panel header. The
    // order is the severity order: a failure, then what the record only
    // declares, then what could not be checked, then what does not apply.
    const badges = Array.from(container.querySelectorAll("span"))
      .filter((element) => element.className.includes("rounded-full"))
      .map((element) => element.textContent);

    expect(badges).toEqual([
      "1/5 verified",
      "Verified",
      "Not verified",
      "Declared",
      "Cannot assess",
      "Not applicable",
    ]);
  });

  it("counts a declaration apart from a verified check", () => {
    render(<QuantForensicsPanel forensics={REPORT} />);

    // The badge on the finding and the count tile in the summary.
    expect(screen.getAllByText("Declared")).toHaveLength(2);
  });

  it("shows the verdict, the counts and the next validation steps", () => {
    render(<QuantForensicsPanel forensics={REPORT} />);

    expect(screen.getByText(REPORT.verdict)).toBeInTheDocument();
    expect(screen.getByText("1/5 verified")).toBeInTheDocument();
    expect(screen.getByText("Next reasonable validation step")).toBeInTheDocument();
    expect(screen.getByText("Re-run across a parameter grid.")).toBeInTheDocument();
    expect(screen.getByText(REPORT.note)).toBeInTheDocument();
  });

  it("names the assessment rules that produced the report", () => {
    render(<QuantForensicsPanel forensics={REPORT} />);
    expect(screen.getByText("Assessment rules v1.0.1")).toBeInTheDocument();
  });

  it("carries the limitation of a check that did not close the question", () => {
    render(<QuantForensicsPanel forensics={REPORT} />);
    expect(
      screen.getByText(/A retrospective result is not independent confirmation\./),
    ).toBeInTheDocument();
  });

  it("does not claim a pass when no assessment is available", () => {
    render(<QuantForensicsPanel forensics={null} />);

    expect(screen.getByText("No forensic assessment is available")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.queryByText(/verified by the stored record/)).not.toBeInTheDocument();
  });
});
