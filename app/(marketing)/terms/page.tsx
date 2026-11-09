import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms that govern use of the Wands terminal and website.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      description="These terms govern your use of the Wands website and terminal. By using either, you agree to them."
    >
      <LegalSection heading="1. Who these terms are between">
        <p>
          These terms are an agreement between you and Wands
          (&ldquo;Wands&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). If you are
          using Wands on behalf of an organisation, you confirm that you have
          authority to bind that organisation to these terms.
        </p>
      </LegalSection>

      <LegalSection heading="2. Eligibility">
        <p>
          You must be at least 18 years old and legally able to enter into a
          contract where you live. You are responsible for ensuring that your use
          of Wands complies with the laws that apply to you, including any rules
          on trading, tax reporting or the use of automated order systems.
        </p>
      </LegalSection>

      <LegalSection heading="3. Your account">
        <p>
          Access requires an active paid subscription. Your account is created
          after Stripe confirms your first payment, and you activate it by opening
          the single-use link we email to the address you paid with. You are
          responsible for keeping your credentials confidential and for all
          activity under your account. Tell us promptly if you believe your
          account has been compromised.
        </p>
        <p>
          You are responsible for the accuracy of the information you provide and
          for maintaining your own records of trades, positions and tax
          obligations.
        </p>
      </LegalSection>

      <LegalSection heading="4. Not investment advice">
        <p>
          Wands is software. We are not a broker, dealer, exchange, investment
          adviser or fiduciary. Nothing in the product or on this site is
          investment, legal, tax or accounting advice, and nothing is a
          recommendation, solicitation or offer to buy or sell any security or
          digital asset.
        </p>
        <p>
          Signals, scores, rankings and backtest results are calculations over
          historical data. They are not predictions. You make your own decisions
          and you bear the consequences of them.
        </p>
      </LegalSection>

      <LegalSection heading="5. Third-party data">
        <p>
          Wands displays data sourced from third parties, including public
          regulatory filings and market data feeds. That data may be delayed,
          incomplete, restated or incorrect. We do not warrant its accuracy or
          completeness, and you should verify anything material against the
          primary source before acting on it.
        </p>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <p>You agree not to:</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>use Wands to break any law or market rule, including market abuse;</li>
          <li>attempt to access accounts, data or systems that are not yours;</li>
          <li>scrape, resell or redistribute the service or its data without written permission;</li>
          <li>interfere with the operation of the service or place unreasonable load on it;</li>
          <li>reverse engineer any part of the service except where the law permits it.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="7. Fees and billing">
        <p>
          Wands is a paid membership. Access requires an active subscription, and
          there is no free tier and no free trial.
        </p>
        <p>
          Subscriptions are billed monthly in advance through Stripe and renew
          automatically on the same date each month until cancelled. The amount,
          currency and billing interval are shown on the pricing page and again at
          checkout before you pay; the figure you see is read from the live Stripe
          price rather than a marketing placeholder.
        </p>
        <p>
          You can cancel at any time from the billing portal in your account. You
          keep access until the end of the period you have already paid for, and
          nothing further is charged. Cancelling does not refund a period already
          used, except where the law requires it.
        </p>
        <p>
          Card details are handled by Stripe and are never stored by Wands. If a
          payment fails, access may be suspended until the balance is settled.
        </p>
      </LegalSection>

      <LegalSection heading="8. Availability and changes">
        <p>
          The service is provided on an evolving basis. Features may be added,
          changed or withdrawn, and the service may be unavailable for
          maintenance or for reasons outside our control. We do not guarantee
          uninterrupted availability.
        </p>
      </LegalSection>

      <LegalSection heading="9. Termination">
        <p>
          You may stop using Wands at any time and request deletion of your
          account. We may suspend or terminate access if you breach these terms,
          if required by law, or if continuing to provide access would create a
          security or legal risk.
        </p>
      </LegalSection>

      <LegalSection heading="10. Disclaimers and limitation of liability">
        <p>
          To the maximum extent permitted by law, the service is provided
          &ldquo;as is&rdquo; without warranties of any kind, express or implied,
          including fitness for a particular purpose and non-infringement.
        </p>
        <p>
          To the maximum extent permitted by law, we are not liable for any
          indirect, incidental, special or consequential loss, or for any trading
          losses, lost profits or lost data, arising from your use of the service.
          Where liability cannot be excluded, it is limited to the amount you paid
          us in the twelve months before the claim.
        </p>
      </LegalSection>

      <LegalSection heading="11. Governing law">
        <p>
          To be completed by counsel: specify the jurisdiction whose laws govern
          these terms, the courts that will hear disputes, and any mandatory
          consumer protections that apply in the user&rsquo;s country of
          residence.
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes to these terms">
        <p>
          We may update these terms as the product changes. Material changes will
          be announced in the product or by email before they take effect.
          Continuing to use Wands after a change means you accept the updated
          terms.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
