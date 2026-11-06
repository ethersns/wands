import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionOutcomePanel } from "@/components/intelligence/action-outcome-panel";
import { ExperimentResultCard } from "@/components/intelligence/experiment-card";
import { InsiderTable } from "@/components/intelligence/insider-table";
import { ProvenanceLabel, TimestampPair } from "@/components/intelligence/provenance-label";
import { ResearchScore } from "@/components/intelligence/score-indicator";
import { UnavailablePanel } from "@/components/intelligence/unavailable-panel";
import type { IntelExperiment } from "@/lib/api/contracts";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function experiment(overrides: Partial<IntelExperiment> = {}): IntelExperiment {
  return {
    id: "exp-1",
    name: "Insider purchase cluster, 5d",
    signalVersion: "1.1.0",
    dataVersion: "2026-01",
    periodStart: "2025-01-01T00:00:00Z",
    periodEnd: "2025-12-31T00:00:00Z",
    informationCutoff: "2025-12-31T00:00:00Z",
    benchmark: "SPY",
    parameters: {},
    executionAssumptions: {},
    costAssumptions: {},
    sampleSize: 0,
    coverage: {},
    metrics: {},
    status: "no_price_data",
    flags: ["no daily bars for 3 symbols"],
    definitionHash: "abcdef0123456789abcdef",
    dataFingerprint: "fedcba9876543210fedcba",
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    ...overrides,
  };
}

describe("failed backend requests", () => {
  it("renders the engine's reason and no figures when research is unavailable", () => {
    render(
      <UnavailablePanel
        envelope={{
          provenance: "unavailable",
          source: "wands-engine",
          warnings: ["Research data unavailable (unreachable): Could not reach the trading engine."],
        }}
      />,
    );

    expect(screen.getByText("Research data unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/Could not reach the trading engine/),
    ).toBeInTheDocument();
    expect(screen.getByText(/source: wands-engine/)).toBeInTheDocument();
  });

  it("renders nothing at all when the payload is live", () => {
    const { container } = render(
      <UnavailablePanel
        envelope={{ provenance: "live", source: "wands-engine", warnings: [] }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("paper versus live provenance", () => {
  it("names the engine as the source of a live payload", () => {
    render(
      <ProvenanceLabel
        provenance="live"
        source="wands-engine"
        generatedAt="2026-01-01T00:00:00Z"
      />,
    );
    expect(screen.getByText("Engine")).toBeInTheDocument();
    expect(screen.getByText("wands-engine")).toBeInTheDocument();
  });

  it("does not present an unavailable payload as live", () => {
    render(
      <ProvenanceLabel
        provenance="unavailable"
        source="wands-engine"
        generatedAt="2026-01-01T00:00:00Z"
      />,
    );
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Engine")).not.toBeInTheDocument();
  });
});

describe("admin-only operations", () => {
  it("shows a refusal as a refusal, never as a success", () => {
    render(
      <ActionOutcomePanel
        outcome={{
          ok: false,
          title: "Could not pause insider_ownership",
          message:
            "The engine refused this action. The configured engine token does not hold the admin role required to change collection jobs.",
          detail: ["error code: unauthorized"],
          at: "2026-01-01T00:00:00Z",
        }}
      />,
    );

    expect(screen.getByText("Could not pause insider_ownership")).toBeInTheDocument();
    expect(screen.getByText(/does not hold the admin role/)).toBeInTheDocument();
    expect(screen.getByText("error code: unauthorized")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("border-loss/30");
  });

  it("marks an acknowledged action as successful", () => {
    render(
      <ActionOutcomePanel
        outcome={{
          ok: true,
          title: "insider_ownership paused",
          message: "The engine acknowledged the change and reports the job as paused.",
          detail: ["paused: yes"],
          at: "2026-01-01T00:00:00Z",
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveClass("border-profit/30");
  });
});

describe("missing experiment metrics", () => {
  it("states the engine's incomplete status and draws no chart", () => {
    const { container } = render(<ExperimentResultCard experiment={experiment()} />);

    expect(screen.getByText("No price data")).toBeInTheDocument();
    expect(screen.getByText("No historical prices for this sample")).toBeInTheDocument();
    expect(
      screen.getByText(/supplied no forward-return statistic/),
    ).toBeInTheDocument();
    expect(screen.getByText("no daily bars for 3 symbols")).toBeInTheDocument();
    // No chart is drawn: an empty axis would read as a zero return.
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("labels the claim type and never calls it realised performance", () => {
    render(<ExperimentResultCard experiment={experiment()} />);
    expect(screen.getByText("Descriptive event study")).toBeInTheDocument();
    expect(
      screen.getByText("not realised account performance"),
    ).toBeInTheDocument();
  });
});

describe("empty intelligence feeds", () => {
  it("explains that an empty insider feed is an absence of collection", () => {
    render(<InsiderTable transactions={[]} />);
    expect(screen.getByText("No insider transactions stored")).toBeInTheDocument();
    expect(
      screen.getByText(/not the same as no insider activity occurring/),
    ).toBeInTheDocument();
  });
});

describe("source timestamp display", () => {
  it("shows the event time and the public availability time separately", () => {
    render(
      <TimestampPair
        eventTime="2026-01-05T00:00:00Z"
        publicAvailableAt="2026-01-07T21:30:00Z"
      />,
    );

    expect(screen.getByText("Event")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("05 Jan 2026, 00:00")).toBeInTheDocument();
    expect(screen.getByText("07 Jan 2026, 21:30")).toBeInTheDocument();
  });

  it("renders a placeholder rather than a date when the event time is absent", () => {
    render(<TimestampPair eventTime={null} publicAvailableAt="2026-01-07T21:30:00Z" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("research score", () => {
  it("renders a dash and an explicit absence when no score exists", () => {
    render(<ResearchScore score={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("No research score available")).toBeInTheDocument();
  });

  it("always describes the score as a ranking, not a probability", () => {
    render(<ResearchScore score={72} />);
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(
      screen.getByText(/Research score 72 of 100, high\. A ranking, not a probability\./),
    ).toBeInTheDocument();
  });
});
