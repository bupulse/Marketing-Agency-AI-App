"use client";

import { ArrowRight, Hourglass } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatCountdown } from "@/lib/waitlist";
import { textOn, type BannerColor, type BannerDecor, type SiteBanner } from "@/lib/site-banner";
import { BANNER_FONT_CLASS, BannerFontLink, bannerFontFamily } from "./banner-fonts";
import { useQuoteCta } from "./quote/cta";
import { useCountdown } from "./waitlist-label";

// The site banner above the menu (lib/site-banner.ts; the owner edits it in Admin -> Settings -> Site banner). BannerBar
// draws it from the settings and is also the live preview in Admin; SiteBannerBar is the public one, whose "quote"
// button opens the quote pop-up.

type Look = { bar: string; chip: string; button: string };

const LOOK: Record<Exclude<BannerColor, "custom">, Look> = {
  brand: { bar: "bg-brand-gradient text-white", chip: "bg-white/15", button: "bg-white text-ink" },
  red: { bar: "bg-[#d91f26] text-white", chip: "bg-black/15", button: "bg-white text-[#b3161c]" },
  orange: { bar: "bg-[#ff7a1a] text-[#1a1006]", chip: "bg-black/10", button: "bg-[#1a1006] text-white" },
  black: { bar: "bg-[#0b0b0f] text-white", chip: "bg-white/12", button: "bg-[#ff7a1a] text-[#1a1006]" },
  green: { bar: "bg-[#0f7a3d] text-white", chip: "bg-black/15", button: "bg-white text-[#0b5f2f]" },
  gold: { bar: "bg-[#f5b70a] text-[#1a1206]", chip: "bg-black/10", button: "bg-[#1a1206] text-white" },
};

/** The big icons: before the message and beside the timer (owner: the tree and two gifts, easy to see). */
const DECOR: Record<Exclude<BannerDecor, "none">, { lead: string; trail: string[] }> = {
  christmas: { lead: "🎄", trail: ["🎁", "🎁"] },
  launch: { lead: "🚀", trail: ["✨"] },
};

function Icon({ char }: { char: string }) {
  return (
    <span aria-hidden className="inline-block shrink-0 font-sans text-[22px] leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)] sm:text-[26px]">
      {char}
    </span>
  );
}

function lookFor(b: SiteBanner): { look: Look; style?: CSSProperties } {
  if (b.color !== "custom") return { look: LOOK[b.color] };
  const light = textOn(b.customColor) === "light";
  return {
    look: light ? { bar: "text-white", chip: "bg-white/15", button: "bg-white text-ink" } : { bar: "text-[#111]", chip: "bg-black/10", button: "bg-[#111] text-white" },
    style: { backgroundColor: b.customColor },
  };
}

/** The banner as the settings describe it. `onQuote` runs for the "quote" button (the pop-up; nothing in the preview). */
export function BannerBar({ banner, onQuote, preview = false }: { banner: SiteBanner; onQuote: () => void; preview?: boolean }) {
  const left = useCountdown(banner.countdownAt ?? "1970-01-01T00:00:00.000Z");
  const counting = banner.countdownAt !== null;
  const done = counting && (left?.done ?? false);
  if (done && banner.whenEnded === "hide" && !preview) return null;

  const { look, style } = lookFor(banner);
  const ended = done && banner.whenEnded === "text";
  const desktop = ended ? banner.endedText : banner.text;
  const phone = ended ? banner.endedText : banner.mobileText || banner.text;
  const scroll = banner.animation === "scroll";
  const decor = banner.decor === "none" ? null : DECOR[banner.decor];

  const message: ReactNode = (
    <>
      <span className="sm:hidden">{phone}</span>
      <span className="hidden sm:inline">{desktop}</span>
    </>
  );

  const buttonClass = cn(
    "inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-semibold no-underline transition-transform hover:-translate-y-px motion-reduce:transition-none",
    look.button,
  );
  const label = (
    <>
      {banner.buttonLabel}
      <ArrowRight aria-hidden className="size-3.5" />
    </>
  );
  let button: ReactNode = null;
  if (banner.button === "quote") {
    button = (
      <button type="button" aria-haspopup="dialog" onClick={onQuote} className={buttonClass}>
        {label}
      </button>
    );
  } else if (banner.button === "link" && banner.buttonUrl) {
    button = banner.buttonUrl.startsWith("/") ? (
      <Link href={banner.buttonUrl} className={buttonClass}>
        {label}
      </Link>
    ) : (
      <a href={banner.buttonUrl} target="_blank" rel="noopener noreferrer" className={buttonClass}>
        {label}
      </a>
    );
  }

  return (
    <div
      role="region"
      aria-label="Announcement"
      style={style}
      className={cn(
        "relative z-40 overflow-hidden",
        look.bar,
        banner.animation === "slide" && "banner-anim-slide",
        banner.animation === "pulse" && "banner-anim-pulse",
        banner.animation === "shimmer" && "banner-anim-shimmer",
      )}
    >
      <BannerFontLink font={banner.font} />
      <div
        style={{ fontFamily: bannerFontFamily(banner.font) }}
        className={cn(
          "relative mx-auto flex max-w-6xl items-center gap-x-3 gap-y-1.5 px-4 py-2 text-[13px] leading-snug sm:text-sm",
          scroll ? "flex-nowrap" : "flex-wrap justify-center text-center",
          BANNER_FONT_CLASS[banner.font],
        )}
      >
        {scroll && decor && <Icon char={decor.lead} />}
        {scroll ? (
          <div className="min-w-0 flex-1 overflow-hidden" aria-label={desktop}>
            <div className="banner-scroll-track flex w-max gap-16 font-medium" aria-hidden>
              <span className="whitespace-nowrap">{message}</span>
              <span className="whitespace-nowrap">{message}</span>
            </div>
          </div>
        ) : (
          // The tree stays beside the words, also when a phone wraps the line.
          <p className="m-0 inline-flex items-center gap-2 font-medium">
            {decor && <Icon char={decor.lead} />}
            <span>{message}</span>
          </p>
        )}
        {decor && (
          <span aria-hidden className="inline-flex shrink-0 items-end -space-x-1">
            {decor.trail.map((c, i) => (
              <span key={i} className={i === 1 ? "inline-block origin-bottom scale-[0.82]" : "inline-block"}>
                <Icon char={c} />
              </span>
            ))}
          </span>
        )}
        {counting && !done && (
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 font-sans font-semibold tabular-nums text-[13px] leading-snug", look.chip)}>
            <Hourglass aria-hidden className="size-3.5" />
            {/* Same width before the first tick, so nothing jumps. */}
            <span className={cn(!left && "invisible")}>{left ? formatCountdown(left, true) : "00d 00h 00m 00s"}</span>
          </span>
        )}
        {button && <span className="shrink-0 font-sans">{button}</span>}
      </div>
    </div>
  );
}

/** The public banner: its "quote" button opens the site's quote pop-up. */
export function SiteBannerBar({ banner }: { banner: SiteBanner }) {
  const { openQuote } = useQuoteCta();
  return <BannerBar banner={banner} onQuote={openQuote} />;
}
