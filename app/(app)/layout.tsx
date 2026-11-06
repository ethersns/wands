import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { getEngineStatus, getMarkets } from "@/lib/api/endpoints";

export const metadata: Metadata = {
  title: {
    default: "Trading Command Centre",
    template: "%s · Wands Terminal",
  },
  robots: { index: false, follow: false },
};

export default async function TerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [engine, markets] = await Promise.all([getEngineStatus(), getMarkets()]);

  return (
    <AppShell engine={engine} markets={markets}>{children}</AppShell>
  );
}
