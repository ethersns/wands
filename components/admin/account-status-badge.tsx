import { Badge } from "@/components/ui/badge";

/**
 * Account status, as distinct from membership status.
 *
 * `active` and `suspended` are the only two values the database allows, so an
 * unrecognised value is shown as-is rather than silently rendered as active —
 * a status the UI cannot explain is a status the operator should see.
 */
export function AccountStatusBadge({ status }: { status: string | null | undefined }) {
  if (status === "suspended") {
    return <Badge variant="loss">Suspended</Badge>;
  }

  if (status === "active" || !status) {
    return <Badge variant="profit">Active</Badge>;
  }

  return <Badge variant="outline">{status}</Badge>;
}

/** Membership status from `member_membership`, which is a different axis. */
export function MembershipStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-[11px] text-muted-foreground">—</span>;

  const variant =
    status === "active"
      ? "profit"
      : status === "trialing"
        ? "primary"
        : status === "past_due" || status === "unpaid"
          ? "loss"
          : "outline";

  return <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>;
}
