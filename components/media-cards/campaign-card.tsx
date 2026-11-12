"use client";

import Link from "next/link";
import { useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CalendarDays, Megaphone, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { campaignDayLabel, compactNumber, dateRangeLabel, progressOf, ringDash } from "./helpers";
import { useInView, usePointerFx } from "./hooks";
import { ActionRow, PlatformIcons, StatusPill } from "./parts";
import type { MediaAction, Platform, StatusKey } from "./types";
import s from "./media-cards.module.css";

export type CampaignCardProps = {
  name: string;
  coverUrl?: string | null;
  status: StatusKey;
  statusLabel?: string | null;
  /** "Product review", "Offer", "Event". */
  kindLabel?: string | null;
  platforms?: readonly Platform[];
  /** Date-only "YYYY-MM-DD" (or ISO); `today` in the business's time zone gives "Day 4 of 18". */
  dates?: { start: string; end: string; today?: string } | null;
  /** The ring: views against the target (creator campaigns), or posts made against planned. */
  metric?: { label: string; value: number; target: number | null } | null;
  /** The bar: money paid against the budget (creator campaigns). Already in whole units. */
  budget?: { spent: number; total: number; currency: string } | null;
  creators?: number | null;
  /** Words for the dates instead of `dates` ("12–14 Oct 2026", "No dates"). */
  dateText?: string | null;
  /** Small facts in the line with the dates ("3 products", "12 texts"). */
  facts?: string[];
  /** More marks under the name's block ("2 new applicants"). */
  extra?: ReactNode;
  /** A short line under the name (the brief, the offer: "20% off"). */
  line?: string | null;
  actions?: MediaAction[];
  href?: string;
  onOpen?: () => void;
  index?: number;
  className?: string;
};

const R = 26;

/**
 * A campaign (a creator campaign paid by views, or a Business info offer or event): the cover with its status (a live
 * campaign's dot pings), platforms and name on it; under it a progress ring for views against the target that fills
 * when it scrolls into view, the budget bar, the dates ("Day 4 of 18") and the creators; actions at the bottom.
 */
export function CampaignCard({ name, coverUrl, status, statusLabel, kindLabel, platforms = [], dates, metric, budget, creators, dateText, facts = [], extra, line, actions = [], href, onOpen, index = 0, className }: CampaignCardProps) {
  const card = useRef<HTMLElement>(null);
  const gid = `mc-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { seen } = useInView(card);
  const [ready, setReady] = useState(false);
  usePointerFx(card, undefined, { tilt: 2.5, lift: 4 });
  const style = { "--i": Math.min(index, 8) } as CSSProperties;
  const p = metric ? progressOf(metric.value, metric.target) : 0;
  const ring = ringDash(seen ? p : 0, R);
  const spent = budget ? progressOf(budget.spent, budget.total) : 0;
  const nameCls = "after:absolute after:inset-0 after:z-[1] after:rounded-[26px] outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-pulse-blue";
  const money = (n: number, c: string) => `${n.toLocaleString("en-GB")} ${c}`;

  return (
    <article ref={card} style={style} className={cn(s.lift, s.post, s.zoomHost, "flex min-w-0 flex-col overflow-hidden rounded-[26px] border border-line bg-surface shadow-[0_1px_2px_rgba(13,16,32,0.04),0_18px_40px_-28px_rgba(20,30,90,0.35)] dark:bg-[#141419]", seen ? s.rise : "opacity-0", className)}>
      <div className="relative aspect-[16/10] overflow-hidden bg-[linear-gradient(135deg,#1b2a6b,#3a1f6e)]">
        {coverUrl ? (
          // Covers are signed storage links, which next/image is not configured for.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
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
          <span aria-hidden className="absolute inset-0 grid place-items-center text-white/40">
            <Megaphone className="size-14 stroke-[1.4]" />
          </span>
        )}
        <span aria-hidden className="absolute inset-0 z-[1] bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,transparent_30%,transparent_45%,rgba(0,0,0,0.72)_100%)]" />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[2] flex items-center justify-between gap-2">
          <StatusPill status={status} label={statusLabel} glass />
          <PlatformIcons platforms={platforms} size={22} />
        </div>
        <div className="absolute inset-x-4 bottom-3 z-[2] text-white">
          {kindLabel && <span className="font-mono text-[10.5px] tracking-[0.1em] text-white/80 uppercase">{kindLabel}</span>}
          <h3 className="line-clamp-2 text-[18px] leading-tight font-semibold tracking-[-0.015em] [text-shadow:0_1px_10px_rgba(0,0,0,.4)]">
            {href ? (
              <Link href={href} className={nameCls}>
                {name}
              </Link>
            ) : onOpen ? (
              <button type="button" onClick={onOpen} className={cn("cursor-pointer text-left", nameCls)}>
                {name}
              </button>
            ) : (
              name
            )}
          </h3>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {line && <p className="line-clamp-2 text-[13.5px] leading-snug text-muted">{line}</p>}
        {(metric || budget) && (
          <div className="flex items-center gap-4">
            {metric && (
              <div className="relative size-[68px] shrink-0">
                <svg viewBox="0 0 64 64" className="size-full -rotate-90" aria-hidden>
                  <defs>
                    <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#2f6bff" />
                      <stop offset="1" stopColor="#7b5cff" />
                    </linearGradient>
                  </defs>
                  <circle cx="32" cy="32" r={R} fill="none" strokeWidth="7" className="stroke-black/[0.07] dark:stroke-white/10" />
                  <circle cx="32" cy="32" r={R} fill="none" strokeWidth="7" strokeLinecap="round" stroke={`url(#${gid})`} strokeDasharray={ring.dasharray} strokeDashoffset={ring.dashoffset} className={s.ring} />
                </svg>
                <span className="absolute inset-0 grid place-items-center text-[14px] font-bold tabular-nums">{metric.target ? `${Math.round(p * 100)}%` : compactNumber(metric.value)}</span>
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2 text-[13px]">
              {metric && (
                <span>
                  <b className="text-[15px] font-semibold tabular-nums">{compactNumber(metric.value)}</b>
                  <span className="text-muted">{metric.target ? ` of ${compactNumber(metric.target)} ${metric.label}` : ` ${metric.label}`}</span>
                </span>
              )}
              {budget && (
                <span className="flex flex-col gap-1">
                  <span className="text-muted">
                    <b className="font-semibold text-text tabular-nums">{money(budget.spent, budget.currency)}</b> of {money(budget.total, budget.currency)}
                  </span>
                  <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
                    <span className={cn(s.bar, "block h-full rounded-full bg-[linear-gradient(90deg,#2f6bff,#7b5cff)]")} style={{ transform: `scaleX(${seen ? spent : 0})` }} />
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
        {extra && <div className="flex flex-wrap gap-1.5">{extra}</div>}
        {(dates || dateText || creators != null || facts.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
            {(dates || dateText) && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays aria-hidden className="size-4" />
                {dateText ?? (dates ? dateRangeLabel(dates.start, dates.end) : "")}
                {dates?.today && <b className="font-semibold text-text"> · {campaignDayLabel(dates.start, dates.end, dates.today)}</b>}
              </span>
            )}
            {creators != null && (
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden className="size-4" />
                {creators} {creators === 1 ? "creator" : "creators"}
              </span>
            )}
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        )}
        {actions.length > 0 && <ActionRow actions={actions} compact className="relative z-[2] mt-auto pt-1" />}
      </div>
    </article>
  );
}
