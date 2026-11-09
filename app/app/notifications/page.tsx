import type { Metadata } from "next";
import Link from "next/link";

import { NotificationList } from "@/components/member/notification-list";
import { PageHeader } from "@/components/member/ui";
import { listNotifications, unreadCount } from "@/lib/member/notifications";
import { requireMember } from "@/lib/member/session";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const session = await requireMember("/app/notifications");
  const userId = session.user.id;

  const [items, unread] = await Promise.all([listNotifications(userId), unreadCount(userId)]);

  return (
    <div>
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        description="In-app alerts produced by your alert rules. Email delivery is not enabled, so nothing is sent to your inbox."
        actions={
          <>
            <Link
              href="/app/alerts"
              className="rounded-lg border border-mk-line px-3 py-2 text-sm text-mk-fg transition-colors hover:border-mk-line-strong"
            >
              Alert rules
            </Link>
            <Link
              href="/app/account"
              className="rounded-lg border border-mk-line px-3 py-2 text-sm text-mk-fg transition-colors hover:border-mk-line-strong"
            >
              Preferences
            </Link>
          </>
        }
      />
      <NotificationList initial={{ items, unread }} />
    </div>
  );
}
