import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionFlash } from "@/components/admin/action-flash";

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

/**
 * The banner is the only confirmation an operator gets after a reactivated
 * account leaves the suspended list, so it has to be announced to assistive
 * technology and it has to be dismissible without losing the current filters.
 */
describe("ActionFlash", () => {
  it("announces the outcome as a status message", () => {
    render(
      <ActionFlash
        message="rowan@example.com was reactivated and can sign in again."
        dismissHref="/dashboard/members/suspended"
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "rowan@example.com was reactivated and can sign in again.",
    );
  });

  it("offers a labelled dismiss control that returns to the filtered list", () => {
    render(
      <ActionFlash
        message="Account reactivated."
        dismissHref="/dashboard/members?accountStatus=suspended&page=2"
      />,
    );

    const dismiss = screen.getByRole("link", { name: "Dismiss message" });
    expect(dismiss).toHaveAttribute(
      "href",
      "/dashboard/members?accountStatus=suspended&page=2",
    );
  });
});
