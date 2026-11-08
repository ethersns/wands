export const siteName = "Wands";

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

export const siteDescription =
  "Go beyond the price chart. Wands brings insider activity, institutional filings and research signals into one workspace built for independent traders.";

export const siteTagline = "Market intelligence for the independently minded";

export const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null;

export const legalUpdated = "8 November 2026";

export interface MarketingNavItem {
  href: string;
  label: string;
}

export const marketingNav: MarketingNavItem[] = [
  { href: "/#platform", label: "Platform" },
  { href: "/#intelligence", label: "Intelligence" },
  { href: "/#research", label: "Research" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export const footerNav: { title: string; items: MarketingNavItem[] }[] = [
  {
    title: "Product",
    items: [
      { href: "/features", label: "Overview" },
      { href: "/features/insider-radar", label: "Insider Radar" },
      { href: "/features/institutional-radar", label: "Institutional Radar" },
      { href: "/features/strategy-lab", label: "Strategy Lab" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    items: [
      { href: "/about", label: "About" },
      { href: "/security", label: "Security" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    items: [
      { href: "/terms", label: "Terms of service" },
      { href: "/privacy", label: "Privacy policy" },
      { href: "/risk-disclosure", label: "Risk disclosure" },
    ],
  },
];

export const primaryCta = { href: "/pricing", label: "Get access" };
