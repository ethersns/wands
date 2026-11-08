"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import type { MemberNotification } from "@/lib/member/notifications";
import { fetcher, sendJson } from "@/lib/member/fetcher";
import { cn } from "@/lib/utils";
import { EmptyState } from "./ui";

type Payload = { items: MemberNotification[]; unread: number };

export function NotificationList({ initial }: { initial: Payload }) {
  const router = useRouter();
  const { data, mutate, error } = useSWR<Payload>("/api/member/notifications", fetcher, { fallbackData: initial });

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  async function markAll() {
    await sendJson("/api/member/notifications", "PATCH");
    await mutate();
    router.refresh();
  }

  async function open(notification: MemberNotification) {
    if (!notification.readAt) {
      await sendJson(`/api/member/notifications/${notification.id}`, "PATCH");
      await mutate();
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-lg border border-mk-warn/30 bg-mk-warn/10 px-3 py-2 text-sm text-mk-warn">
          {error.message}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="font-marketing-mono text-[11px] uppercase tracking-[0.14em] text-mk-dim">
          {unread} unread
        </p>
        {unread > 0 ? (
          <button
            type="button"
            onClick={markAll}
            className="rounded-md border border-mk-line px-2.5 py-1.5 text-xs text-mk-muted transition-colors hover:border-mk-line-strong hover:text-mk-fg"
          >
            Mark all read
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="Alerts appear here once an alert rule matches something. Delivery is in-app only; email alerts are not enabled."
          action={
            <Link
              href="/app/alerts"
              className="inline-flex items-center rounded-lg bg-mk-accent px-3 py-2 text-sm font-semibold text-mk-accent-ink transition-opacity hover:opacity-90"
            >
              Set up an alert rule
            </Link>
          }
        />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-mk-line bg-mk-surface/60">
          {items.map((notification) => {
            const body = (
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    notification.readAt ? "bg-mk-dim" : "bg-mk-accent",
                  )}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className={cn("text-sm text-pretty", notification.readAt ? "text-mk-muted" : "text-mk-fg")}>
                    {notification.title}
                  </p>
                  {notification.body ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-mk-muted text-pretty">{notification.body}</p>
                  ) : null}
                  <p className="mt-1 font-marketing-mono text-[10px] uppercase tracking-[0.12em] text-mk-dim">
                    {new Date(notification.createdAt).toISOString().replace("T", " ").slice(0, 16)} UTC
                  </p>
                </div>
              </div>
            );

            return (
              <li key={notification.id} className="border-b border-mk-line last:border-b-0">
                {notification.href ? (
                  <Link
                    href={notification.href}
                    onClick={() => open(notification)}
                    className="block px-4 py-3.5 transition-colors hover:bg-mk-raised/60"
                  >
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => open(notification)}
                    className="block w-full px-4 py-3.5 text-left transition-colors hover:bg-mk-raised/60"
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
