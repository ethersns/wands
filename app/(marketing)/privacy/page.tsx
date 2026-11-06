import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Wands collects, why it is collected, how long it is kept and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      description="What we collect, why we collect it, and what you can ask us to do with it."
    >
      <LegalSection heading="1. What we collect">
        <p>
          <span className="text-mk-fg">Waitlist and contact details.</span> If you
          join the waitlist or send a message, we store the email address you
          give us, any optional details you choose to add, and the time of
          submission.
        </p>
        <p>
          <span className="text-mk-fg">Account and usage data.</span> If you are
          invited to the terminal, we store the information needed to operate
          your account: your email, authentication records, the connections you
          create, and the orders, watchlists and backtests you run.
        </p>
        <p>
          <span className="text-mk-fg">Technical data.</span> We record basic
          request information such as timestamps and error diagnostics so we can
          keep the service working and secure.
        </p>
      </LegalSection>

      <LegalSection heading="2. Why we collect it">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>to operate the waitlist and invite people in order;</li>
          <li>to provide the terminal and the features you use;</li>
          <li>to respond to messages you send us;</li>
          <li>to keep the service secure and diagnose faults;</li>
          <li>to meet legal and accounting obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. What we do not do">
        <p>
          We do not sell your personal data. We do not share your positions,
          watchlists or backtests with other users. We do not use your trading
          data to publish performance figures.
        </p>
      </LegalSection>

      <LegalSection heading="4. Cookies and local storage">
        <p>
          The marketing site does not set advertising cookies. The terminal uses
          cookies strictly to keep you signed in and to protect requests against
          cross-site forgery. Blocking those cookies will prevent sign-in from
          working.
        </p>
      </LegalSection>

      <LegalSection heading="5. Service providers">
        <p>
          We use third-party providers for hosting, database infrastructure and
          email delivery. They process data on our instructions and only for the
          purposes above. A current list of sub-processors is available on
          request.
        </p>
      </LegalSection>

      <LegalSection heading="6. Retention">
        <p>
          Waitlist entries are kept until you ask to be removed or until the beta
          closes. Contact messages are kept for as long as needed to handle the
          request and any follow-up. Account data is kept while your account is
          open, then deleted or anonymised on request.
        </p>
      </LegalSection>

      <LegalSection heading="7. Your rights">
        <p>
          Depending on where you live, you may have the right to access, correct,
          export or delete your personal data, to object to certain processing,
          and to complain to a supervisory authority. To exercise any of these,
          use the contact form and select the closest topic.
        </p>
      </LegalSection>

      <LegalSection heading="8. Security">
        <p>
          Credentials are stored encrypted and never sent to the browser. Access
          to production systems is limited to people who need it to operate the
          service. No system is perfectly secure, and we will tell affected users
          if a breach affects their data.
        </p>
      </LegalSection>

      <LegalSection heading="9. Children">
        <p>
          Wands is not intended for anyone under 18 and we do not knowingly
          collect data from children.
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes and contact">
        <p>
          If this policy changes materially, we will announce it in the product or
          by email. Questions about privacy can be sent through the contact form.
        </p>
        <p>
          To be completed by counsel: the identity and registered address of the
          data controller, the nominated data protection contact, and the
          representative required in any jurisdiction where one is mandatory.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
