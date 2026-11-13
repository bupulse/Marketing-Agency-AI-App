import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import { CARD, FOCUS, LIFT, type KitTone } from "@/components/admin/kit/tones";
import { cn } from "@/lib/cn";

/**
 * A slim card that opens another page: icon, title, one line, an optional value on the right and an arrow. For the
 * "more is one tap away" links at the bottom of a page (Lead alerts, Tags and fields...), where a tall SectionCard would
 * take too much room. Works in server and browser components.
 */
export function LinkRow({ href, icon, tone = "blue", title, hint, value, className }: { href: string; icon: LucideIcon; tone?: KitTone; title: string; hint?: ReactNode; value?: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("group flex min-w-0 items-center gap-3 p-3.5 text-text no-underline sm:px-5", CARD, LIFT, FOCUS, className)}>
      <IconBadge icon={icon} tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold leading-snug">{title}</span>
        {hint && <span className="line-clamp-2 text-[13px] leading-snug text-muted">{hint}</span>}
      </span>
      {value != null && <span className="hidden shrink-0 rounded-full bg-soft px-3 py-1 text-[13px] font-semibold sm:inline">{value}</span>}
      <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-soft text-muted transition-[transform,background-color,color] duration-200 group-hover:translate-x-0.5 group-hover:bg-pulse-blue group-hover:text-white motion-reduce:transform-none">
        <ArrowRight className="size-4" />
      </span>
    </Link>
  );
}
