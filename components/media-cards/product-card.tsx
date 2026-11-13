"use client";

import { HostLink } from "@/components/platform/hosts";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/cn";
import { useInView, usePointerFx } from "./hooks";
import { ActionRow, StatusPill } from "./parts";
import type { MediaAction, StatusKey } from "./types";
import s from "./media-cards.module.css";

export type ProductCardProps = {
  name: string;
  imageUrl?: string | null;
  /** Already formatted (helpers.ts priceLabel): "25,000 RWF", "From 6,000 RWF". */
  price?: string | null;
  /** "Discount from 3 pieces". */
  priceNote?: string | null;
  /** One or two sentences. */
  summary?: string | null;
  category?: string | null;
  /** "Product", "Service", "Digital". */
  kindLabel?: string | null;
  /** Shown when it is not simply active ("draft", or "ended" for archived). */
  status?: StatusKey | null;
  statusLabel?: string | null;
  /** Small facts in the glass panel: [{ label: "Posts", value: "12" }]. */
  stats?: { label: string; value: string }[];
  /** Make a post, Edit, See its posts... */
  actions?: MediaAction[];
  /** More marks on the photo's top right ("From Shopify"). */
  badges?: ReactNode;
  /** More under the summary ("Needs details: add a price"). */
  extra?: ReactNode;
  /** Where the card goes (the product's page). */
  href?: string;
  onOpen?: () => void;
  index?: number;
  className?: string;
};

/**
 * A product or service, like a shop shelf card in BuPulse's look: the photo on a soft brand gradient (it zooms a little
 * under the pointer), the kind and status on it, the name, a short line and the price. On hover or keyboard focus a
 * liquid-glass panel rises over the photo with its numbers and actions; phones show the actions under the card.
 */
export function ProductCard({ name, imageUrl, price, priceNote, summary, category, kindLabel, status, statusLabel, stats = [], badges, extra, actions = [], href, onOpen, index = 0, className }: ProductCardProps) {
  const card = useRef<HTMLElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const { seen } = useInView(card);
  const [ready, setReady] = useState(false);
  usePointerFx(card, glass, { tilt: 3, lift: 5 });
  const style = { "--i": Math.min(index, 8) } as CSSProperties;
  const nameCls = "after:absolute after:inset-0 after:z-[1] after:rounded-[26px] outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-pulse-blue";

  return (
    <article ref={card} style={style} className={cn(s.lift, s.post, s.zoomHost, "flex min-w-0 flex-col overflow-hidden rounded-[26px] border border-line bg-surface shadow-[0_1px_2px_rgba(13,16,32,0.04),0_18px_40px_-28px_rgba(20,30,90,0.35)] dark:bg-[#141419]", seen ? s.rise : "opacity-0", className)}>
      <div className="relative aspect-[4/5] overflow-hidden bg-[radial-gradient(120%_90%_at_20%_10%,#eaf0ff,transparent_60%),radial-gradient(120%_90%_at_90%_90%,#f1ecff,transparent_60%)] dark:bg-[radial-gradient(120%_90%_at_20%_10%,#1a2350,transparent_60%),radial-gradient(120%_90%_at_90%_90%,#2a1d52,transparent_60%)]">
        {imageUrl ? (
          // Product photos are signed storage links, which next/image is not configured for.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setReady(true)}
            ref={(el) => {
              if (el?.complete && el.naturalWidth && !ready) setReady(true);
            }}
            className={cn(s.media, ready ? "opacity-100" : "opacity-0")}
          />
        ) : (
          <span aria-hidden className="absolute inset-0 grid place-items-center text-pulse-blue/70">
            <Package className="size-14 stroke-[1.4]" />
          </span>
        )}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[2] flex items-start justify-between gap-2">
          {kindLabel ? <span className="rounded-full border border-white/40 bg-white/70 px-2.5 py-1 text-[11.5px] font-semibold text-[#1d1d1f] backdrop-blur-md dark:border-white/15 dark:bg-black/45 dark:text-white">{kindLabel}</span> : <span />}
          <span className="flex flex-col items-end gap-1.5">
            {status && <StatusPill status={status} label={statusLabel} glass />}
            {badges}
          </span>
        </div>
        {(stats.length > 0 || actions.length > 0) && (
          <div className={cn(s.productGlass, "absolute inset-x-2.5 bottom-2.5 z-[3]")}>
            <div ref={glass} className={cn(s.glass, "!bg-[linear-gradient(135deg,rgba(20,24,48,0.55),rgba(20,24,48,0.3))]")}>
              {stats.length > 0 && (
                <dl className="mb-2.5 flex gap-4">
                  {stats.map((st) => (
                    <div key={st.label} className="min-w-0">
                      <dt className="text-[11px] tracking-wide text-white/75 uppercase">{st.label}</dt>
                      <dd className="text-[16px] font-semibold">{st.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <ActionRow actions={actions} onDark />
            </div>
          </div>
        )}
      </div>
      {/* Not positioned: the name's stretched link (nameCls) covers the whole card, photo included, from the article. */}
      <div className="flex flex-1 flex-col gap-1 p-4">
        {category && <span className="truncate font-mono text-[11px] tracking-[0.08em] text-pulse-blue uppercase dark:text-[#8db0ff]">{category}</span>}
        <h3 className="line-clamp-2 text-[17px] leading-tight font-semibold tracking-[-0.015em]">
          {href ? (
            <HostLink href={href} className={nameCls}>
              {name}
            </HostLink>
          ) : onOpen ? (
            <button type="button" onClick={onOpen} className={cn("cursor-pointer text-left", nameCls)}>
              {name}
            </button>
          ) : (
            name
          )}
        </h3>
        {summary && <p className="line-clamp-2 text-[13.5px] leading-snug text-muted">{summary}</p>}
        {extra}
        <div className="mt-auto flex items-baseline justify-between gap-2 pt-2">
          {price && <span className="bg-[linear-gradient(90deg,#2f6bff,#7b5cff)] bg-clip-text text-[18px] font-bold tracking-[-0.02em] text-transparent">{price}</span>}
          {priceNote && <span className="truncate text-[12px] text-muted">{priceNote}</span>}
        </div>
        {actions.length > 0 && <ActionRow actions={actions} compact className="relative z-[2] pt-2 [@media(hover:hover)]:hidden" />}
      </div>
    </article>
  );
}
