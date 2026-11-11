"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/cn";
import { useScrollProgress, writeProgressVar } from "./scroll-scene";
import "./motion.css";

// A week of daily posts that slides sideways as you scroll down (the section is pinned while it moves). The posts are
// an example for a salon, labelled as one, and each picture is a finished post from BuPulse's own design engine
// (lib/designs/library, the same renderer as client posts), with the example salon's logo made by the same engine.
// Photos: one still from BuPulse's own salon ad (Wednesday) and AI photos made with the app's image model where no
// real photo fitted (docs/design/front-page-motion.md, round 3). The facts beside them are how daily posts really
// work (docs/CONTENT.md, owner decisions of 31 October and 3 November 2026: approval, lunchtime posting, missed posts
// moving on).

type Day = {
  id: string;
  day: string;
  alt: string;
  caption: string;
  status: string;
  state: "posted" | "approved" | "waiting" | "planned";
};

const week: Day[] = [
  {
    id: "mon",
    day: "Monday",
    alt: "Post: “Fresh braids for a fresh week”, a photo of long, neat box braids from behind, with “Book now”",
    caption: "New week, fresh braids. Book your slot before Friday: weekends fill up fast.",
    status: "Posted at 12:30",
    state: "posted",
  },
  {
    id: "tue",
    day: "Tuesday",
    alt: "Tip post: “Keep your braids neat for longer”, a satin scarf, a comb and hair oil on a salon counter",
    caption: "Three small habits our stylists swear by. Which one do you already do?",
    status: "Posted at 12:00",
    state: "posted",
  },
  {
    id: "wed",
    day: "Wednesday",
    alt: "Post: “Meet the team”, a framed photo of a smiling stylist in her salon",
    caption: "The hands behind your favourite look. Say hello on your next visit.",
    status: "Posted at 13:00",
    state: "posted",
  },
  {
    id: "thu",
    day: "Thursday",
    alt: "Offer post: “A free wash and style with every braids booking this week”, a client having her hair washed",
    caption: "This week only: a free wash and style with every braids booking.",
    status: "Approved · goes out at 12:30",
    state: "approved",
  },
  {
    id: "fri",
    day: "Friday",
    alt: "Before and after post: “Two hours, one big smile”, short natural hair on the left, long braids on the right",
    caption: "Before and after: two hours, one big smile. Which look is next?",
    status: "Waiting for your tap",
    state: "waiting",
  },
  {
    id: "sat",
    day: "Saturday",
    alt: "Bookings post: “Free slots this afternoon, from 2 pm”, an empty, sunny salon in a round frame",
    caption: "Two chairs free this afternoon. Message us to book, or just walk in.",
    status: "Made the night before",
    state: "planned",
  },
  {
    id: "sun",
    day: "Sunday",
    alt: "Post: “Ready for Monday?”, a smiling woman admiring her new braids in the mirror",
    caption: "Start the week looking your best. See you soon.",
    status: "Made the night before",
    state: "planned",
  },
];

export function WeekOfPosts() {
  // The heading scrolls by normally; then the row of posts pins and slides (the track is what scrolls past).
  const ref = useRef<HTMLDivElement>(null);
  const onProgress = useCallback((p: number) => writeProgressVar(ref.current, p), []);
  useScrollProgress(ref, onProgress);

  return (
    <section id="daily-posts" aria-labelledby="week-title" data-scene="light" className="wk scroll-mt-24">
      <div className="wk-head">
        <p className="m-0 text-sm font-semibold tracking-[0.14em] text-ok uppercase">Daily posts</p>
        <h2 id="week-title" className="m-0 text-[clamp(30px,4.6vw,54px)] leading-[1.05] font-bold tracking-[-0.035em]">
          A new post every day. <span className="text-gradient">You just tap approve.</span>
        </h2>
        <p className="wk-lead m-0 max-w-2xl text-[17px] leading-relaxed text-muted sm:text-lg">
          Every night BuPulse makes the next day’s post from what it knows about your business: the picture, the words and the hashtags, in your colours. In the morning you approve it with one tap, or let BuPulse post it for you.
        </p>
      </div>
      <div ref={ref} className="wk-track">
        <div className="wk-stage">
          <div className="wk-viewport">
            <ol className="wk-row" aria-label="An example week of posts for a salon">
              {week.map((d) => (
                <li key={d.id} className="wk-card">
                  <p className="wk-top m-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a 2 KB logo, the same file on every card */}
                    <img src="/marketing/week/salon-logo.webp" alt="" width={28} height={28} loading="lazy" decoding="async" className="wk-logo" />
                    <span className="min-w-0 flex-1 truncate font-semibold">Your salon</span>
                    <span className="wk-day">{d.day}</span>
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP posts with srcset; next/image would add a server round trip per size */}
                  <img
                    className="wk-post"
                    src={`/marketing/week/${d.id}-600.webp`}
                    srcSet={`/marketing/week/${d.id}-300.webp 300w, /marketing/week/${d.id}-600.webp 600w`}
                    sizes="(min-width: 768px) 290px, 248px"
                    alt={d.alt}
                    width={600}
                    height={750}
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="flex flex-col gap-2 px-4 pt-3 pb-4">
                    <p className="wk-caption m-0 text-[14px] leading-snug">
                      {d.caption} <span className="text-ok">#Salon #Braids</span>
                    </p>
                    <p className={cn("wk-status m-0", `wk-${d.state}`)}>{d.status}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div aria-hidden className="wk-progress">
            <span className="wk-bar" />
          </div>
          <p className="wk-label m-0 text-center text-xs text-muted">Example week for a salon, designed by BuPulse. Yours is made for your business, with your photos.</p>
        </div>
      </div>
    </section>
  );
}
