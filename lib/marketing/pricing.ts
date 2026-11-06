export interface Plan {
  id: "observer" | "operator" | "desk";
  name: string;
  price: string;
  cadence: string;
  summary: string;
  features: string[];
  featured?: boolean;
  priceIdKey?: "operator" | "desk";
}

export const plans: Plan[] = [
  {
    id: "observer",
    name: "Observer",
    price: "$0",
    cadence: "forever",
    summary: "Research without execution. For anyone who wants to see the evidence first.",
    features: [
      "Insider Radar with 30-day signal history",
      "Institutional Radar, latest quarter",
      "One watchlist",
      "Read-only market data",
      "Community support",
    ],
  },
  {
    id: "operator",
    name: "Operator",
    price: "$49",
    cadence: "per month",
    summary: "For active self-directed traders who validate before they size.",
    features: [
      "Everything in Observer",
      "Strategy Lab with out-of-sample runs",
      "Full signal history and exports",
      "Risk Centre with enforced limits",
      "Paper trading accounts",
      "Email support",
    ],
    featured: true,
    priceIdKey: "operator",
  },
  {
    id: "desk",
    name: "Desk",
    price: "$149",
    cadence: "per month",
    summary: "For small funds and traders running more than one account.",
    features: [
      "Everything in Operator",
      "Multiple portfolios and accounts",
      "Automated bots with a global kill switch",
      "Priority data refresh",
      "API access",
      "Onboarding call",
    ],
    priceIdKey: "desk",
  },
];

export const pricingFaq = [
  {
    question: "Is billing live yet?",
    answer:
      "No. Wands is in a private beta and every plan is free while we onboard the first cohort. Pricing is published so you know what it will cost when billing opens, and we will give existing beta members notice before anything is charged.",
  },
  {
    question: "Do I need a card to join the waitlist?",
    answer:
      "No. The waitlist takes an email address and nothing else. Payment details are only requested if and when you choose to start a paid plan.",
  },
  {
    question: "Can I change plan later?",
    answer:
      "Yes. Plans are designed to move up and down without losing your data, watchlists or backtest history.",
  },
  {
    question: "What happens if I cancel?",
    answer:
      "Your account drops to Observer at the end of the paid period. Your data stays available and exportable; nothing is deleted because a subscription lapsed.",
  },
];
