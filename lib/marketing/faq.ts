export interface FaqItem {
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    question: "What is Wands, exactly?",
    answer:
      "Wands is a market intelligence and execution terminal. It ingests SEC filings, institutional holdings and market data, ranks what actually changed, and gives you a place to validate a thesis and control risk before you commit capital.",
  },
  {
    question: "Where does the data come from?",
    answer:
      "Primary sources. Insider transactions come from SEC Form 4 filings, institutional holdings from 13F filings, and prices from market data feeds. Every signal keeps a link to the filing it came from, along with the date it was filed and the time it was ingested.",
  },
  {
    question: "Is Wands financial advice?",
    answer:
      "No. Wands is software. It presents data, calculations and historical simulations. It does not know your circumstances, it does not recommend securities, and it does not manage money. Every decision, and every consequence of it, is yours.",
  },
  {
    question: "Can Wands trade for me?",
    answer:
      "It can, if you explicitly grant trading permission on a connection. Connections are read-only by default, trading permissions are opt-in per connection, and a single control halts every bot and cancels open orders.",
  },
  {
    question: "How is this different from a stock screener?",
    answer:
      "A screener filters on price and fundamentals. Wands works on events — a cluster of insider purchases, a fund building a position, a filing that contradicts the narrative — and it shows you the source for each one. It also tests whether the idea survives costs and out-of-sample data, which a screener never does.",
  },
  {
    question: "Do you support both crypto and equities?",
    answer:
      "Yes. The terminal covers equities and crypto in one portfolio view. Filing-based intelligence applies to equities; market data, strategy validation and risk controls apply to both.",
  },
  {
    question: "How does access work?",
    answer:
      "Wands is a paid membership. You pay through Stripe, we email a single-use activation link to the address you paid with, and you set your password to open the workspace. There is no free tier and no free trial.",
  },
  {
    question: "What does it cost?",
    answer:
      "One membership, billed monthly. The exact amount, currency and billing interval are shown on the pricing page and again at checkout before you pay — the figure is read from the live Stripe price, not a marketing placeholder.",
  },
  {
    question: "Can I delete my data?",
    answer:
      "Yes. You can request deletion of your account and associated data at any time, and we will confirm once it is done. See the privacy policy for what is retained and for how long.",
  },
];
