"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * Fires one beacon per public page view.
 *
 * This is the one place a `useEffect` is the right tool: the beacon is a
 * fire-and-forget side effect with no state to render, and it has to run on the
 * client because the marketing pages are statically rendered — a server-side
 * counter would only fire on a cache miss and would undercount badly.
 *
 * `sendBeacon` is used so the request survives a navigation that unloads the
 * page, which is exactly when a page view is most likely to be lost.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const lastSent = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!pathname) return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    const body = JSON.stringify({
      path: pathname,
      referrer: document.referrer || null,
    });

    const url = `/api/track${window.location.search}`;

    try {
      if (typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(url, blob)) return;
      }

      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Measurement must never surface an error to a visitor.
    }
  }, [pathname]);

  return null;
}
