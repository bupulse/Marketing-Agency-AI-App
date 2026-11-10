import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconBadge } from "./icon-badge";
import { CountBubble } from "./status-pill";
import { CARD, FOCUS, LIFT, type KitTone } from "./tones";

/**
 * A card that opens another page: icon badge, title, a one-line hint and (optionally) one key number with a few words
 * under it. The whole card is the link; it lifts on hover and shows the brand accent. `count` adds a to-do bubble in
 * the corner (a red one for things waiting).
 */
export function SectionCard({
  href,
  icon,
  tone = "blue",
  title,
  hint,
  value,
  valueLabel,
  count,
  countTone = "danger",
  countLabel,
  row = false,
  className,
}: {
  href: string;
  icon: LucideIcon;
  tone?: KitTone;
  title: string;
  hint?: ReactNode;
  /** The one number that matters here ("12", "RWF 1.2M"). */
  value?: ReactNode;
  /** A few words under the number ("paying clients"). */
  valueLabel?: ReactNode;
  count?: number;
  countTone?: "danger" | "violet" | "neutral";
  /** What the bubble counts, for screen readers ("3 payments to check"). */
  countLabel?: string;
  /** On a phone, a slim row (icon, title, hint, number) instead of a tall card: for lists of cards one under another. */
  row?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("group relative flex min-w-0 flex-col gap-3 overflow-hidden p-3.5 text-text no-underline sm:p-5", CARD, LIFT, FOCUS, className)}>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-brand-gradient opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
      {row && (
        <div className="flex items-center gap-3 sm:hidden">
          <IconBadge icon={icon} tone={tone} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-bold leading-snug">{title}</span>
            {hint && <span className="line-clamp-2 text-[12.5px] leading-snug text-muted">{hint}</span>}
            {value != null && (
              <span className="pt-0.5 text-[12.5px] text-muted">
                <span className="font-bold tabular-nums text-text">{value}</span> {valueLabel}
              </span>
            )}
          </span>
          {count != null && <CountBubble count={count} tone={countTone} label={countLabel} className="text-[12px]" />}
          <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
        </div>
      )}
      <div className={cn("flex min-w-0 flex-1 flex-col gap-3", row && "max-sm:hidden")}>
      <div className="flex items-start justify-between gap-2">
        <IconBadge icon={icon} tone={tone} />
        {count != null && <CountBubble count={count} tone={countTone} label={countLabel} className="text-[12px]" />}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[16px] font-bold leading-snug tracking-[-0.01em]">{title}</span>
        {hint && <span className="line-clamp-2 text-[13px] leading-snug text-muted">{hint}</span>}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        {value != null ? (
          <span className="flex min-w-0 flex-col">
            <span className={cn("font-bold leading-tight tabular-nums tracking-[-0.02em]", typeof value === "string" && value.length > 9 ? "whitespace-nowrap text-[15px] sm:text-[22px]" : "break-words text-[19px] sm:text-[22px]")}>{value}</span>
            {valueLabel && <span className="pt-1 text-[12px] text-muted">{valueLabel}</span>}
          </span>
        ) : (
          <span className="text-[13px] font-semibold text-pulse-blue dark:text-[#8db0ff]">Open</span>
        )}
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-soft text-muted transition-[transform,background-color,color] duration-200 group-hover:translate-x-0.5 group-hover:bg-pulse-blue group-hover:text-white motion-reduce:transform-none">
          <ArrowRight className="size-4" />
        </span>
      </div>
      </div>
    </Link>
  );
}

/** The grid section cards sit in: one column on a phone, two on a tablet, three (or `cols={4}`) on a computer. */
export function SectionGrid({ children, cols = 3, className }: { children: ReactNode; cols?: 2 | 3 | 4; className?: string }) {
  return <div className={cn("kit-rise grid grid-cols-1 gap-3 sm:grid-cols-2", cols === 3 && "xl:grid-cols-3", cols === 4 && "lg:grid-cols-3 xl:grid-cols-4", className)}>{children}</div>;
}
