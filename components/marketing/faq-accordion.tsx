"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { FaqItem } from "@/lib/marketing/faq";

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <Accordion type="single" collapsible className="w-full">
      {items.map((item, index) => (
        <AccordionItem
          key={item.question}
          value={`item-${index}`}
          className="border-mk-line"
        >
          <AccordionTrigger className="py-4 text-left text-[14.5px] font-medium text-mk-fg hover:text-mk-accent [&>svg]:text-mk-dim">
            {item.question}
          </AccordionTrigger>
          <AccordionContent className="max-w-2xl pb-4 text-[13.5px] leading-relaxed text-mk-muted">
            {item.answer}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
