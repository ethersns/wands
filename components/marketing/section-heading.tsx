import { cn } from "@/lib/utils";

import { Eyebrow } from "./eyebrow";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Tag
        className={cn(
          "font-display text-balance text-3xl font-semibold tracking-[-0.035em] text-mk-fg sm:text-4xl lg:text-[2.75rem] lg:leading-[1.05]",
          align === "center" && "max-w-3xl",
        )}
      >
        {title}
      </Tag>
      {description ? (
        <p
          className={cn(
            "max-w-2xl text-pretty text-[15px] leading-relaxed text-mk-muted sm:text-base",
            align === "center" && "mx-auto",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
