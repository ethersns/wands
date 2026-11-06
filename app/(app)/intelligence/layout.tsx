import type { Metadata } from "next";

import { IntelNav } from "@/components/intelligence/intel-nav";

export const metadata: Metadata = {
  title: "Intelligence",
  description:
    "Research terminal for SEC insider filings, institutional disclosures and measured signal performance. Informational only — it cannot place an order.",
};

export default function IntelligenceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <IntelNav />
      {children}
    </div>
  );
}
