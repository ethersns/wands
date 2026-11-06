import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MarketingLayout from "@/app/(marketing)/layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/pricing",
}));

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

function renderMarketing() {
  return render(
    <MarketingLayout>
      <p>Marketing body</p>
    </MarketingLayout>,
  );
}

describe("marketing layout", () => {
  it("renders the public navigation and the marketing body", () => {
    renderMarketing();

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByText("Marketing body")).toBeInTheDocument();
  });

  it("offers the commercial calls to action", () => {
    renderMarketing();

    expect(screen.getAllByRole("link", { name: /pricing/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it("never renders the private trading shell", () => {
    renderMarketing();

    // The console sidebar links to these; a public page must not.
    expect(screen.queryByRole("link", { name: /dashboard/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /portfolio/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /risk centre/i })).toBeNull();
    expect(screen.queryByText(/emergency stop/i)).toBeNull();
  });

  it("renders the marketing footer", () => {
    renderMarketing();

    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
