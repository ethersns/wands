import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivationLinkActions } from "@/components/admin/activation-link-actions";

vi.mock("@/lib/admin/actions", () => ({
  issueActivationLinkAction: async () => ({ ok: true, message: "issued" }),
  emailActivationLinkAction: async () => ({ ok: true, message: "sent" }),
  revokeActivationLinkAction: async () => ({ ok: true, message: "revoked" }),
}));

/**
 * The controls an operator uses to get a paid customer into the product.
 *
 * Two things matter here beyond the buttons existing: the email control must
 * not be offered on a deployment that cannot send email, and the revoke control
 * must not be offered when there is nothing to revoke — both would be dead ends
 * that look like working controls.
 */
describe("ActivationLinkActions", () => {
  it("offers a link and hides email when no provider is configured", () => {
    render(
      <ActivationLinkActions
        intentId="intent_1"
        email="member@example.com"
        hasLiveLink={false}
        emailConfigured={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Get link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Email" })).not.toBeInTheDocument();
  });

  it("offers email when a provider is configured", () => {
    render(
      <ActivationLinkActions
        intentId="intent_1"
        email="member@example.com"
        hasLiveLink={false}
        emailConfigured
      />,
    );

    expect(screen.getByRole("button", { name: "Email" })).toBeInTheDocument();
  });

  it("only offers revoke when a live link exists", () => {
    const { rerender } = render(
      <ActivationLinkActions
        intentId="intent_1"
        email="member@example.com"
        hasLiveLink={false}
        emailConfigured={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();

    rerender(
      <ActivationLinkActions
        intentId="intent_1"
        email="member@example.com"
        hasLiveLink
        emailConfigured={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("opens a dialog that names the customer and warns the old link dies", () => {
    render(
      <ActivationLinkActions
        intentId="intent_1"
        email="member@example.com"
        hasLiveLink={false}
        emailConfigured={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Get link" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Activation link for member@example.com");
    expect(dialog).toHaveTextContent("stops the old one working");
    expect(screen.getByRole("button", { name: "Issue link" })).toBeInTheDocument();
  });
});
