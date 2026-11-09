"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders a server page while a payment is still settling.
 *
 * Stripe's confirmation arrives by webhook, not by the browser, so the page the
 * customer lands on after checkout is usually a few seconds ahead of the
 * database. Polling the server component is the honest way to show that: the
 * page keeps saying "being confirmed" until the webhook has actually landed,
 * rather than optimistically claiming success.
 */
export function PendingRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
