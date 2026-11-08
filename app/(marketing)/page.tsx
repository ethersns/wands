import type { Metadata } from "next";

import { EarlyAccess } from "@/components/marketing/early-access";
import { Hero } from "@/components/marketing/hero";
import { IntelligenceSection } from "@/components/marketing/intelligence-section";
import { NextChapter } from "@/components/marketing/next-chapter";
import { ResearchSection } from "@/components/marketing/research-section";
import { siteDescription } from "@/lib/marketing/site";

export const metadata: Metadata = {
  title: "Wands — Market intelligence for the independently minded",
  description: siteDescription,
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <>
      <Hero />
      <IntelligenceSection />
      <ResearchSection />
      <NextChapter />
      <EarlyAccess />
    </>
  );
}
