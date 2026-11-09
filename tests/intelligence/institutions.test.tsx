import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InstitutionHoldings } from "@/components/member/institution-holdings";
import { InstitutionRow } from "@/components/member/institution-row";
import { institutionChangesPath } from "@/lib/api/research";
import type { Institution, InstitutionalHoldingChange } from "@/lib/api/contracts";

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

const SEC_URL = "https://www.sec.gov/Archives/edgar/data/1067983/000106798324000002/table.xml";

function institution(overrides: Partial<Institution> = {}): Institution {
  return {
    cik: "0001067983",
    name: "Berkshire Hathaway Inc",
    periods: ["2024-03-31T00:00:00Z", "2024-06-30T00:00:00Z"],
    latestPeriod: "2024-06-30T00:00:00Z",
    latestPublicAvailableAt: "2024-08-14T20:00:00Z",
    reportedValueUsd: 1_234_000_000,
    positionCount: 42,
    caveats: [],
    ...overrides,
  };
}

function change(overrides: Partial<InstitutionalHoldingChange> = {}): InstitutionalHoldingChange {
  return {
    cusip: "037833100",
    issuerName: "APPLE INC",
    classTitle: "COM",
    changeType: "increased",
    currentShares: 150,
    priorShares: 100,
    currentValueUsd: 1_500_000,
    priorValueUsd: 1_000_000,
    shareChange: 50,
    shareChangePct: 50,
    periodOfReport: "2024-06-30T00:00:00Z",
    priorPeriodOfReport: "2024-03-31T00:00:00Z",
    publicAvailableAt: "2024-08-14T20:00:00Z",
    sourceUrl: SEC_URL,
    ...overrides,
  };
}

function renderHoldings(changes: InstitutionalHoldingChange[]) {
  return render(
    <InstitutionHoldings
      changes={changes}
      periodOfReport="2024-06-30T00:00:00Z"
      priorPeriodOfReport="2024-03-31T00:00:00Z"
    />,
  );
}

describe("institution discovery rows", () => {
  it("links a filer to its research page by CIK", () => {
    render(
      <ul>
        <InstitutionRow institution={institution()} />
      </ul>,
    );

    const link = screen.getByRole("link", { name: "Berkshire Hathaway Inc" });
    expect(link).toHaveAttribute("href", "/app/institutions/0001067983");
  });

  it("reports the filing period and the date it became public", () => {
    render(
      <ul>
        <InstitutionRow institution={institution()} />
      </ul>,
    );

    expect(screen.getByText("2024-06-30")).toBeInTheDocument();
    expect(screen.getByText("2024-08-14")).toBeInTheDocument();
    expect(screen.getByText("$1.23B")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("does not present an uncollected filer as holding zero positions", () => {
    render(
      <ul>
        <InstitutionRow
          institution={institution({
            periods: [],
            latestPeriod: null,
            latestPublicAvailableAt: null,
            reportedValueUsd: null,
            positionCount: 0,
          })}
        />
      </ul>,
    );

    expect(screen.getByText("not collected")).toBeInTheDocument();
    expect(screen.getByText("not disclosed")).toBeInTheDocument();
    expect(screen.getByText("No quarter stored for this filer")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("labels the figures as reported holdings rather than a current position", () => {
    render(
      <ul>
        <InstitutionRow institution={institution()} />
      </ul>,
    );

    expect(screen.getByText(/reported holdings, not a current position/)).toBeInTheDocument();
  });
});

describe("institution holdings changes", () => {
  it("names each change type and the quarter it describes", () => {
    renderHoldings([
      change({ cusip: "AAA", issuerName: "ALPHA", changeType: "new", priorShares: null, shareChange: null }),
      change({ cusip: "BBB", issuerName: "BETA", changeType: "exited", currentShares: null, currentValueUsd: null }),
      change({ cusip: "CCC", issuerName: "GAMMA", changeType: "decreased", shareChange: -20, shareChangePct: -10 }),
    ]);

    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Exited")).toBeInTheDocument();
    expect(screen.getByText("Decreased")).toBeInTheDocument();
    expect(screen.getByText(/quarter ended 2024-06-30/)).toBeInTheDocument();
    expect(screen.getByText(/compared with 2024-03-31/)).toBeInTheDocument();
  });

  it("describes an exit as a reported absence, not an observed sale", () => {
    renderHoldings([
      change({ cusip: "BBB", issuerName: "BETA", changeType: "exited", currentShares: null, currentValueUsd: null }),
    ]);

    expect(
      screen.getByText(/No position reported; 100 shares in the prior quarter/),
    ).toBeInTheDocument();
    expect(screen.getByText("no position")).toBeInTheDocument();
    expect(screen.queryByText(/sold/i)).not.toBeInTheDocument();
  });

  it("filters to one change type and keeps the full count visible", () => {
    renderHoldings([
      change({ cusip: "AAA", issuerName: "ALPHA", changeType: "new", priorShares: null, shareChange: null }),
      change({ cusip: "BBB", issuerName: "BETA", changeType: "exited", currentShares: null, currentValueUsd: null }),
      change({ cusip: "CCC", issuerName: "GAMMA", changeType: "decreased", shareChange: -20 }),
    ]);

    expect(screen.getByText("ALPHA")).toBeInTheDocument();
    expect(screen.getByText("BETA")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Exited 1$/ }));

    expect(screen.queryByText("ALPHA")).not.toBeInTheDocument();
    expect(screen.getByText("BETA")).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 reported changes/)).toBeInTheDocument();
  });

  it("sorts by reported value by default and by issuer on request", () => {
    renderHoldings([
      change({ cusip: "AAA", issuerName: "ZETA CORP", currentValueUsd: 1_000 }),
      change({ cusip: "BBB", issuerName: "ALPHA CORP", currentValueUsd: 9_000 }),
    ]);

    const rows = () => screen.getAllByRole("listitem").map((row) => row.textContent ?? "");

    expect(rows()[0]).toContain("ALPHA CORP");

    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "issuer" } });

    expect(rows()[0]).toContain("ALPHA CORP");
    expect(rows()[1]).toContain("ZETA CORP");
  });

  it("links a claim to the SEC document that supports it", () => {
    renderHoldings([change()]);

    const link = screen.getByRole("link", { name: "SEC filing" });
    expect(link).toHaveAttribute("href", SEC_URL);
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("says so when no source document was resolved", () => {
    renderHoldings([change({ sourceUrl: "" })]);

    expect(screen.getByText("no source link resolved")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "SEC filing" })).not.toBeInTheDocument();
  });

  it("refuses to render a source link that is not http", () => {
    renderHoldings([change({ sourceUrl: "javascript:alert(1)" })]);

    expect(screen.queryByRole("link", { name: "SEC filing" })).not.toBeInTheDocument();
    expect(screen.getByText("no source link resolved")).toBeInTheDocument();
  });

  it("tolerates the engine's string-encoded decimals", () => {
    renderHoldings([
      change({
        currentValueUsd: "1500000.00" as unknown as number,
        priorValueUsd: "1000000.00" as unknown as number,
        currentShares: "150" as unknown as number,
      }),
    ]);

    expect(screen.getByText("$1.50M")).toBeInTheDocument();
    expect(screen.getByText("150 sh")).toBeInTheDocument();
  });

  it("explains an empty filter result without implying the quarter was empty", () => {
    renderHoldings([change({ changeType: "increased" })]);

    // Only the types present are offered, so the toolbar cannot select an
    // absent type and the list is never silently blank.
    const toolbar = screen.getByRole("group", { name: "Filter by change type" });
    expect(within(toolbar).queryByRole("button", { name: /^Exited/ })).not.toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /^Increased 1$/ })).toBeInTheDocument();
  });
});

describe("the institution changes contract", () => {
  it("addresses the engine's documented endpoint", () => {
    expect(institutionChangesPath("0001067983")).toBe(
      "/v1/intelligence/institutions/0001067983/changes",
    );
  });

  it("passes a quarter through as the period parameter", () => {
    expect(institutionChangesPath("0001067983", "2024-03-31T00:00:00Z")).toBe(
      "/v1/intelligence/institutions/0001067983/changes?period=2024-03-31T00%3A00%3A00Z",
    );
  });

  it("encodes a CIK so it cannot escape the path", () => {
    expect(institutionChangesPath("../orders")).toBe(
      "/v1/intelligence/institutions/..%2Forders/changes",
    );
  });
});
