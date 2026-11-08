import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { requireOperator } from "@/lib/admin/guard";
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
  // The shell reads engine status and markets, so the gate has to run before
  // either fetch. Every page below re-checks as well; this one covers the
  // chrome and the two engine calls it makes on the page's behalf.
  await requireOperator();

  const [engine, markets] = await Promise.all([getEngineStatus(), getMarkets()]);

  return (
    <AppShell engine={engine} markets={markets}>{children}</AppShell>
  );
}
