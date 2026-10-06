import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type SectionHeadingProps = {
  eyebrow?: string;
  title: ReactNode;
  text?: ReactNode;
  align?: "left" | "center";
  /** Heading level to render (default h2). */
  as?: "h1" | "h2" | "h3";
  className?: string;
};

export function SectionHeading({ eyebrow, title, text, align = "center", as: H = "h2", className }: SectionHeadingProps) {
  return (
    <div className={cn("flex max-w-2xl flex-col gap-3", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && (
        <p className="text-gradient text-sm font-semibold tracking-[0.12em] uppercase">{eyebrow}</p>
      )}
      <H className="text-[clamp(30px,4vw,48px)] leading-[1.08] font-bold tracking-[-0.03em]">{title}</H>
      {text && <p className="text-lg leading-relaxed text-muted">{text}</p>}
    </div>
  );
}
