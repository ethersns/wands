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
  findings: [
    finding("point_in_time_eligibility", "Point-in-time eligibility", "verified"),
    finding("parameter_sensitivity", "Parameter sensitivity", "cannot_assess", {
      nextStep: "Re-run across a parameter grid.",
    }),
    finding("out_of_sample_independence", "Out-of-sample independence", "not_verified", {
      limitation: "A retrospective result is not independent confirmation.",
      nextStep: "Freeze the rule and measure it on a later window.",
    }),
    finding("publication_versus_transaction", "Filing publication", "not_applicable"),
  ],
  counts: { total: 4, verified: 1, notVerified: 1, cannotAssess: 1, notApplicable: 1 },
  verdict: "1 of 4 checks are verified by the stored record.",
  nextSteps: [
    "Re-run across a parameter grid.",
    "Freeze the rule and measure it on a later window.",
  ],
  note: "This assessment reads the stored experiment.",
};

describe("Research Forensics panel", () => {
  it("separates what was verified from what was not established", () => {
    const { container } = render(<QuantForensicsPanel forensics={REPORT} />);
    const text = container.textContent ?? "";

    const verifiedHeading = text.indexOf("What the record verifies");
    const unestablishedHeading = text.indexOf("What the record does not establish");
    const verifiedFinding = text.indexOf("Point-in-time eligibility");
    const unassessableFinding = text.indexOf("Parameter sensitivity");

    expect(verifiedHeading).toBeGreaterThan(-1);
    expect(unestablishedHeading).toBeGreaterThan(verifiedHeading);
    expect(verifiedFinding).toBeGreaterThan(verifiedHeading);
    expect(verifiedFinding).toBeLessThan(unestablishedHeading);
    expect(unassessableFinding).toBeGreaterThan(unestablishedHeading);
  });

  it("never renders an unassessable check as verified", () => {
    const { container } = render(<QuantForensicsPanel forensics={REPORT} />);

    // One badge per finding, plus the summary badge in the panel header. The
    // order is the severity order: a failure, then what could not be checked,
    // then what does not apply.
    const badges = Array.from(container.querySelectorAll("span"))
      .filter((element) => element.className.includes("rounded-full"))
      .map((element) => element.textContent);

    expect(badges).toEqual([
      "1/4 verified",
      "Verified",
      "Not verified",
      "Cannot assess",
      "Not applicable",
    ]);
  });

  it("shows the verdict, the counts and the next validation steps", () => {
    render(<QuantForensicsPanel forensics={REPORT} />);

    expect(screen.getByText(REPORT.verdict)).toBeInTheDocument();
    expect(screen.getByText("1/4 verified")).toBeInTheDocument();
    expect(screen.getByText("Next reasonable validation step")).toBeInTheDocument();
    expect(screen.getByText("Re-run across a parameter grid.")).toBeInTheDocument();
    expect(screen.getByText(REPORT.note)).toBeInTheDocument();
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
