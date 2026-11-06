export const siteName = "Wands";

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

export const siteDescription =
  "Wands turns SEC filings, institutional holdings and market data into ranked, evidence-backed signals — then lets you validate the thesis before you commit capital.";

export const siteTagline = "Market intelligence for people who trade on evidence";

export const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null;

export const legalUpdated = "6 November 2026";

export interface MarketingNavItem {
  href: string;
  label: string;
}

export const marketingNav: MarketingNavItem[] = [
  { href: "/features", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
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

export const primaryCta = { href: "/#access", label: "Request access" };
