"use client";

import { CalendarClock, Camera, Gift, Lightbulb, Scissors, Sparkles, Users, type LucideIcon } from "lucide-react";
import { useCallback, useRef } from "react";
import { cn } from "@/lib/cn";
import { useScrollProgress, writeProgressVar } from "./scroll-scene";
import "./motion.css";

// A week of daily posts that slides sideways as you scroll down (the section is pinned while it moves). The posts are
// an example for a salon, labelled as one; the facts beside them are how daily posts really work (docs/CONTENT.md,
// owner decisions of 31 October and 3 November 2026: approval, lunchtime posting, missed posts moving on).

type Day = { day: string; kind: string; title: string; caption: string; status: string; state: "posted" | "approved" | "waiting" | "planned"; icon: LucideIcon; angle: number };

const week: Day[] = [
  { day: "Mon", kind: "New look", title: "Fresh braids for a fresh week", caption: "Book your slot before Friday: weekends fill up fast.", status: "Posted at 12:30", state: "posted", icon: Scissors, angle: 135 },
  { day: "Tue", kind: "Tip", title: "Keep your braids neat for longer", caption: "Three small habits our stylists swear by.", status: "Posted at 12:00", state: "posted", icon: Lightbulb, angle: 160 },
  { day: "Wed", kind: "Behind the chair", title: "Meet the team", caption: "The hands behind your favourite look. Say hello on your next visit.", status: "Posted at 13:00", state: "posted", icon: Users, angle: 200 },
  { day: "Thu", kind: "Offer", title: "This week only", caption: "A free wash and style with every braids booking.", status: "Approved · goes out at 12:30", state: "approved", icon: Gift, angle: 110 },
  { day: "Fri", kind: "Before and after", title: "Two hours, one big smile", caption: "Swipe to see the change. Which look is next?", status: "Waiting for your tap", state: "waiting", icon: Camera, angle: 240 },
  { day: "Sat", kind: "Bookings", title: "Free slots this afternoon", caption: "Message us to book, or just walk in.", status: "Made the night before", state: "planned", icon: CalendarClock, angle: 70 },
  { day: "Sun", kind: "Shine", title: "Ready for Monday?", caption: "Start the week looking your best. See you soon.", status: "Made the night before", state: "planned", icon: Sparkles, angle: 300 },
];

export function WeekOfPosts() {
  const ref = useRef<HTMLElement>(null);
  const onProgress = useCallback((p: number) => writeProgressVar(ref.current, p), []);
  useScrollProgress(ref, onProgress);

  return (
    <section ref={ref} id="daily-posts" aria-labelledby="week-title" data-scene="light" className="wk scroll-mt-24">
      <div className="wk-stage">
        <div className="wk-head">
          <p className="m-0 text-sm font-semibold tracking-[0.14em] text-ok uppercase">Daily posts</p>
          <h2 id="week-title" className="m-0 text-[clamp(30px,4.6vw,54px)] leading-[1.05] font-bold tracking-[-0.035em]">
            A new post every day. <span className="text-gradient">You just tap approve.</span>
          </h2>
          <p className="m-0 max-w-2xl text-[17px] leading-relaxed text-muted sm:text-lg">
            Every night BuPulse makes the next day’s post from what it knows about your business: the picture, the words
            and the hashtags, in your colours. In the morning you approve it with one tap, or let BuPulse post it for you.
          </p>
        </div>
        <div className="wk-viewport">
          <ol className="wk-row" aria-label="An example week of posts for a salon">
            {week.map((d) => {
              const Icon = d.icon;
              return (
                <li key={d.day} className="wk-card">
                  <div className="wk-art" style={{ background: `linear-gradient(${d.angle}deg, #2f6bff, #7b5cff)` }}>
                    <span className="wk-day">{d.day}</span>
                    <Icon aria-hidden className="wk-icon" />
                    <Icon aria-hidden className="wk-icon-big" strokeWidth={1.25} />
                    <span className="wk-kind">{d.kind}</span>
                    <strong className="wk-title">{d.title}</strong>
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    <p className="m-0 flex items-center gap-2 text-[13px] font-semibold">
                      <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-brand-gradient text-[11px] text-white">
                        S
                      </span>
                      Your salon
                    </p>
                    <p className="m-0 text-[14px] leading-snug">
                      {d.caption} <span className="text-ok">#Salon #Braids</span>
                    </p>
                    <p className={cn("wk-status m-0", `wk-${d.state}`)}>{d.status}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <div aria-hidden className="wk-progress">
          <span className="wk-bar" />
        </div>
        <p className="wk-label m-0 text-center text-xs text-muted">Example week for a salon. Yours is written for your business.</p>
      </div>
    </section>
  );
}
