import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Risk disclosure",
  description:
    "The risks of trading, of automated execution, and of relying on historical data and third-party filings.",
  alternates: { canonical: "/risk-disclosure" },
};

export default function RiskDisclosurePage() {
  return (
    <LegalPage
      title="Risk disclosure"
      description="Trading involves substantial risk. Read this before you connect an account or act on anything you see in Wands."
    >
      <LegalSection heading="1. You can lose money">
        <p>
          Trading securities and digital assets can result in the loss of some or
          all of your capital, and in some structures — margin, leverage,
          derivatives — losses can exceed your initial deposit. Only risk capital
          you can afford to lose entirely.
        </p>
      </LegalSection>

      <LegalSection heading="2. Past performance is not predictive">
        <p>
          Historical results, including any backtest produced in Strategy Lab, are
          simulations. They are produced with assumptions about fills, fees,
          slippage and liquidity that may not hold in live markets. A strategy
          that performed well on historical data can lose money immediately in
          live conditions.
        </p>
      </LegalSection>

      <LegalSection heading="3. Automation risk">
        <p>
          Automated execution can place orders faster and more often than a human
          would. Errors in configuration, connectivity failures, exchange outages
          and unexpected market conditions can all cause unintended orders or
          missed exits. You are responsible for the strategies you enable and for
          monitoring them.
        </p>
      </LegalSection>

      <LegalSection heading="4. Data risk">
        <p>
          Wands relies on third-party filings and market data. Filings can be
          amended or restated. Feeds can be delayed, interrupted or wrong. A
          signal computed from incorrect data will be incorrect. Verify anything
          material against the primary source before you act on it.
        </p>
      </LegalSection>

      <LegalSection heading="5. Filing lag">
        <p>
          Insider transactions are typically reported within two business days.
          Institutional holdings are reported quarterly, up to 45 days after the
          period they describe. By the time a filing is public, the position it
          describes may already have changed.
        </p>
      </LegalSection>

      <LegalSection heading="6. Digital asset risk">
        <p>
          Digital assets trade continuously, can move sharply outside market
          hours, and are subject to custody, counterparty and regulatory risk that
          differs from regulated securities markets. Rules vary significantly by
          jurisdiction.
        </p>
      </LegalSection>

      <LegalSection heading="7. No advice, no fiduciary duty">
        <p>
          Wands does not provide investment advice and does not act as your
          fiduciary. Nothing in the product is tailored to your circumstances,
          objectives or financial position. If you need advice, consult a
          licensed professional in your jurisdiction.
        </p>
      </LegalSection>

      <LegalSection heading="8. Jurisdiction">
        <p>
          To be completed by counsel: the jurisdictions in which the service is
          offered, any restrictions on the instruments or users that may be
          supported, and the specific risk warnings required by the regulator in
          each of those jurisdictions.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
