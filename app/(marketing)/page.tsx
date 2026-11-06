import type { Metadata } from "next";

import { FinalCta } from "@/components/marketing/final-cta";
import { FoundingAccess } from "@/components/marketing/founding-access";
import { Hero } from "@/components/marketing/hero";
import { LensSwitcher } from "@/components/marketing/lens-switcher";
import { Manifesto } from "@/components/marketing/manifesto";
import { ProductStage } from "@/components/marketing/product-stage";
import { SourceStrip } from "@/components/marketing/source-strip";
import {
  ActInsider,
  ActInstitutional,
  ActProblem,
  ActResearch,
  ActSignal,
} from "@/components/marketing/story";
import { WaitlistPanel } from "@/components/marketing/waitlist-panel";
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
      <SourceStrip />
      <ActProblem />
      <ProductStage />
      <ActInsider />
      <ActInstitutional />
      <ActSignal />
      <ActResearch />
      <LensSwitcher />
      <Manifesto />
      <FoundingAccess />
      <WaitlistPanel />
      <FinalCta />
    </>
  );
}
