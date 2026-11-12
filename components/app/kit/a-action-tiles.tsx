import Link from "next/link";
import { ArrowRight, ExternalLink, type LucideIcon } from "lucide-react";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import { CARD, FOCUS, LIFT, type KitTone } from "@/components/admin/kit/tones";
import { cn } from "@/lib/cn";

export type ActionTile = {
  id: string;
  label: string;
  /** One plain line under the label. */
  text: string;
  href: string;
  icon: LucideIcon;
  tone?: KitTone;
  /** A plain link in a new tab, never prefetched (the Video Studio writes a sign-in ticket per visit). */
  external?: boolean;
};

const TONES: KitTone[] = ["blue", "violet", "indigo", "pink"];

/**
 * Big "what do you want to do?" cards: an icon, a verb, one line, and the whole card is the link. Two a row on a
 * phone, up to four on a computer; they rise in on load and lift on hover (both off under reduced motion). Works in
 * server components.
 */
export function ActionTiles({ items, className }: { items: ActionTile[]; className?: string }) {
  return (
    <ul className={cn("kit-rise grid grid-cols-2 gap-3", items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "lg:grid-cols-3" : "", className)}>
      {items.map((a, i) => {
        const cls = cn("group relative flex h-full min-h-[132px] flex-col gap-3 overflow-hidden p-4 text-text no-underline sm:p-5", CARD, LIFT, FOCUS);
        const body = (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-brand-gradient opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
            <IconBadge icon={a.icon} tone={a.tone ?? TONES[i % TONES.length]} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[16px] font-bold leading-snug tracking-[-0.01em]">{a.label}</span>
              <span className="line-clamp-2 text-[13px] leading-snug text-muted">{a.text}</span>
            </span>
            <span aria-hidden className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-full bg-soft text-muted transition-[transform,background-color,color] duration-200 group-hover:translate-x-0.5 group-hover:bg-pulse-blue group-hover:text-white motion-reduce:transform-none">
              {a.external ? <ExternalLink className="size-4" /> : <ArrowRight className="size-4" />}
            </span>
          </>
        );
        return (
          <li key={a.id} className="flex">
            {a.external ? (
              <a href={a.href} target="_blank" rel="noopener" className={cn(cls, "w-full")}>
                {body}
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <Link href={a.href} className={cn(cls, "w-full")}>
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
