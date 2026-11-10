import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconBadge } from "./icon-badge";
import { FOCUS, type KitTone } from "./tones";

/**
 * The top of an admin page: a gradient icon badge, the title, one plain line saying what the page is for, and the
 * page's main buttons on the right (under the title on a phone). `back` adds a small "back to ..." link above.
 */
export function PageHeader({
  icon,
  tone = "blue",
  title,
  description,
  actions,
  eyebrow,
  back,
  className,
}: {
  icon?: LucideIcon;
  tone?: KitTone;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A small line above the title (the area name, a date). */
  eyebrow?: ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-3 px-1", className)}>
      {back && (
        <Link href={back.href} className={cn("inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full pr-3 text-[13px] font-semibold text-muted no-underline hover:text-text", FOCUS)}>
          <ArrowLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          {icon && <IconBadge icon={icon} tone={tone} size="lg" className="mt-0.5" />}
          <div className="flex min-w-0 flex-col gap-1">
            {eyebrow && <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">{eyebrow}</p>}
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] sm:text-[30px]">{title}</h1>
            {description && <p className="max-w-2xl text-[15px] leading-snug text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
      </div>
    </header>
  );
}
