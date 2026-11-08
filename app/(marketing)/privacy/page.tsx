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
          <span className="text-mk-fg">Sign-in history.</span> We record that an
          account signed in and when. This is a record of the event only: no IP
          address, no browser string, no token and no credential material.
        </p>
        <p>
          <span className="text-mk-fg">Technical data.</span> We record basic
          request information such as timestamps and error diagnostics so we can
          keep the service working and secure.
        </p>
      </LegalSection>

      <LegalSection heading="2. How we measure the site">
        <p>
          We measure our own marketing pages with a first-party counter. There is
          no third-party analytics script, no advertising pixel and no
          cross-site tracker anywhere on this site.
        </p>
        <p>
          <span className="text-mk-fg">What a page view records.</span> The page
          path, the time, and whether the visitor was signed in as the operator.
          We also record where the visit came from: the referring host, a coarse
          category for it (direct, internal, search, social or referral), and any
          UTM campaign parameters on the link you followed.
        </p>
        <p>
          <span className="text-mk-fg">How unique visitors are counted.</span> To
          count visitors without following anyone, we compute a keyed digest of
          your IP address and browser string. The key is derived from a secret
          plus the calendar day, so it is different every day. The digest cannot
          be reversed, and yesterday&apos;s digests cannot be recomputed from
          today&apos;s key — not even by us. It can tell us that two visits on the
          same day were probably the same person. It cannot link a visit on
          Monday to a visit on Tuesday, and it is not a cookie.
        </p>
        <p>
          <span className="text-mk-fg">What is never recorded.</span> Your IP
          address, your browser string and any cookie value are used to compute
          the digest and then discarded. They are not stored. Private surfaces —
          the terminal, the member workspace, sign-in and every API route — are
          refused by the counter, so it cannot be used to probe whether a private
          page exists.
        </p>
      </LegalSection>

      <LegalSection heading="3. Why we collect it">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>to operate the waitlist and invite people in order;</li>
          <li>to provide the terminal and the features you use;</li>
          <li>to respond to messages you send us;</li>
          <li>to understand which pages are read, in aggregate;</li>
          <li>to keep the service secure and diagnose faults;</li>
          <li>to meet legal and accounting obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. What we do not do">
        <p>
          We do not sell your personal data. We do not share your positions,
          watchlists or backtests with other users. We do not use your trading
          data to publish performance figures. We do not build advertising
          profiles, and we do not combine the site measurement described above
          with your account.
        </p>
      </LegalSection>

      <LegalSection heading="5. Cookies and local storage">
        <p>
          The marketing site sets no advertising cookies and no analytics
          cookies. The terminal uses cookies strictly to keep you signed in and
          to protect requests against cross-site forgery. Blocking those cookies
          will prevent sign-in from working.
        </p>
        <p>
          The page-view counter does not set a cookie and does not write to local
          storage. It has nothing to store on your device.
        </p>
      </LegalSection>

      <LegalSection heading="6. Service providers">
        <p>
          We use third-party providers for hosting, database infrastructure and
          email delivery. They process data on our instructions and only for the
          purposes above. A current list of sub-processors is available on
          request.
        </p>
      </LegalSection>

      <LegalSection heading="7. Retention">
        <p>
          <span className="text-mk-fg">Site measurement.</span> Page-view rows are
          deleted automatically once they are more than 400 days old.
        </p>
        <p>
          <span className="text-mk-fg">Sign-in history.</span> Sign-in events are
          deleted automatically once they are more than 400 days old.
        </p>
        <p>
          <span className="text-mk-fg">Everything else.</span> Waitlist entries
          are kept until you ask to be removed or until the beta closes. Contact
          messages are kept for as long as needed to handle the request and any
          follow-up. Account data is kept while your account is open, then
          deleted or anonymised on request.
        </p>
      </LegalSection>

      <LegalSection heading="8. Your rights and controls">
        <p>
          Depending on where you live, you may have the right to access, correct,
          export or delete your personal data, to object to certain processing,
          and to complain to a supervisory authority. To exercise any of these,
          use the contact form and select the closest topic.
        </p>
        <p>
          <span className="text-mk-fg">Turning measurement off.</span> A content
          blocker, a browser that blocks the beacon, or a client that sends Do
          Not Track will stop the page-view counter. The site works normally
          without it.
        </p>
        <p>
          <span className="text-mk-fg">A limit worth stating plainly.</span>{" "}
          Because the visitor digest changes every day and no IP address is kept,
          we cannot pick out one person&apos;s page views to export or delete. We
          can delete the aggregate rows for a period, and we will do that on
          request. Account, waitlist and contact data are tied to you and can be
          exported or erased individually.
        </p>
      </LegalSection>

      <LegalSection heading="9. Security">
        <p>
          Credentials are stored encrypted and never sent to the browser. Access
          to production systems is limited to people who need it to operate the
          service. No system is perfectly secure, and we will tell affected users
          if a breach affects their data.
        </p>
      </LegalSection>

      <LegalSection heading="10. Children">
        <p>
          Wands is not intended for anyone under 18 and we do not knowingly
          collect data from children.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes and contact">
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
