/**
 * The published membership.
 *
 * There is one plan and no free tier. The amount is deliberately absent from
 * this file: the price shown to a visitor is read from the configured Stripe
 * Price at render time, so the page can never advertise a number the checkout
 * would not charge.
 */

export interface FoundingPlan {
  id: "founding";
  name: string;
  cadence: string;
  summary: string;
  features: { title: string; detail: string }[];
}

export const foundingPlan: FoundingPlan = {
  id: "founding",
  name: "Wands Founding Access",
  cadence: "per month",
  summary:
    "Insider intelligence, institutional research and the tools to look deeper into market activity.",
  features: [
    {
      title: "Insider Radar",
      detail: "Full signal history with filing provenance on every transaction.",
    },
    {
      title: "Institutional Radar",
      detail: "13F position changes, quarter over quarter, with the source filing.",
    },
    {
      title: "Strategy Lab",
      detail: "Out-of-sample validation before you size anything.",
    },
    {
      title: "Saved research",
      detail: "Watchlists, saved signals and notes that stay with your account.",
    },
    {
      title: "Billing you control",
      detail: "Update your card, cancel renewal or resume from the billing portal.",
    },
  ],
};

export const pricingFaq = [
  {
    question: "Is there a free plan?",
    answer:
      "No. Wands is a paid research platform and there is no free tier and no free trial. Every account is backed by an active subscription, which is what pays for the data behind the research.",
  },
  {
    question: "What does it cost?",
    answer:
      "Wands Founding Access is billed monthly. The exact amount, currency and billing interval are shown on this page and again at checkout before you pay — the figure you see is read from the live Stripe price, not a marketing placeholder.",
  },
  {
    question: "When am I charged?",
    answer:
      "Once at checkout, then automatically on the same date each month until you cancel. There is no setup fee and no minimum term.",
  },
  {
    question: "What happens if I cancel?",
    answer:
      "You keep full access until the end of the period you have already paid for, and nothing further is charged. Your watchlists, saved research and notes are preserved, so reactivating later picks up where you left off.",
  },
  {
    question: "How do I get into my account after paying?",
    answer:
      "Stripe confirms the payment to us directly, and we email an activation link to the address you paid with. Open it to set your password. The link is single-use and expires in 24 hours.",
  },
];
