import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Container } from "@/components/marketing/container";
import { CtaBand } from "@/components/marketing/cta-band";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { InsiderRadarShowcase } from "@/components/marketing/showcase/insider-radar";
import { InstitutionalRadarShowcase } from "@/components/marketing/showcase/institutional-radar";
import { StrategyLabShowcase } from "@/components/marketing/showcase/strategy-lab";
import { featureBySlug, featureDetails } from "@/lib/marketing/features";

const showcases: Record<string, React.ReactNode> = {
  "insider-radar": <InsiderRadarShowcase />,
  "institutional-radar": <InstitutionalRadarShowcase />,
  "strategy-lab": <StrategyLabShowcase />,
};

export function generateStaticParams() {
  return featureDetails.map((feature) => ({ slug: feature.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const feature = featureBySlug(slug);

  if (!feature) return { title: "Feature not found" };

  return {
    title: feature.name,
    description: feature.subhead,
    alternates: { canonical: `/features/${feature.slug}` },
    openGraph: {
      title: `${feature.name} · Wands`,
      description: feature.subhead,
      url: `/features/${feature.slug}`,
    },
  };
}

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const feature = featureBySlug(slug);

  if (!feature) notFound();

  return (
    <>
      <section className="relative overflow-hidden border-b border-mk-line">
        <div
          className="mk-grid mk-fade-b pointer-events-none absolute inset-0 opacity-60"
          aria-hidden
        />
        <Container className="relative">
          <div className="flex max-w-3xl flex-col gap-5 py-16 sm:py-24">
            <Link
              href="/features"
              className="inline-flex items-center gap-1.5 font-marketing-mono text-[10.5px] tracking-[0.12em] text-mk-dim uppercase transition-colors hover:text-mk-muted"
            >
              <ArrowLeft className="size-3" aria-hidden />
              All product
            </Link>
            <Eyebrow>{feature.eyebrow}</Eyebrow>
            <h1 className="font-display text-balance text-4xl font-semibold tracking-[-0.04em] text-mk-fg sm:text-5xl lg:text-[3.25rem] lg:leading-[1.03]">
              {feature.headline}
            </h1>
            <p className="max-w-2xl text-pretty text-[15.5px] leading-relaxed text-mk-muted sm:text-[17px]">
              {feature.subhead}
            </p>
          </div>
        </Container>
      </section>

      <Container>
        <div className="py-12 sm:py-16">
          {showcases[feature.slug]}
          <p className="mt-4 font-marketing-mono text-[10px] tracking-[0.1em] text-mk-dim uppercase">
            {feature.footnote}
          </p>
        </div>

        <div className="grid gap-10 border-t border-mk-line py-12 sm:py-16 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="flex flex-col gap-3">
            <Eyebrow>The problem</Eyebrow>
            <p className="text-pretty text-[15px] leading-relaxed text-mk-muted">
              {feature.problem}
            </p>
          </div>
          <div className="flex flex-col gap-5">
            <Eyebrow>How Wands handles it</Eyebrow>
            <ol className="flex flex-col gap-4">
              {feature.approach.map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span className="mt-0.5 font-marketing-mono text-[10.5px] tracking-[0.1em] text-mk-accent">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="text-[13.5px] leading-relaxed text-mk-muted">
                    {step}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="grid gap-8 border-t border-mk-line py-12 sm:grid-cols-3 sm:py-16">
          {feature.highlights.map((highlight) => (
            <div key={highlight.title} className="flex flex-col gap-1.5">
              <h2 className="text-[13.5px] font-medium text-mk-fg">
                {highlight.title}
              </h2>
              <p className="text-[13px] leading-relaxed text-mk-muted">
                {highlight.body}
              </p>
            </div>
          ))}
        </div>
      </Container>

      <CtaBand source={`feature-${feature.slug}`} />
    </>
  );
}
