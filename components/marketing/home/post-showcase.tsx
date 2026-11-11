"use client";

import { useCallback, useRef } from "react";
import { useScrollProgress, writeProgressVar } from "./scroll-scene";
import "./motion.css";

// "Designs in your brand": a pinned wall of posts made by BuPulse's own design engine (lib/designs/library, rendered
// for example businesses and saved in public/marketing/posts). As you scroll, the tilted wall settles from close up to
// its place, its three rows drift in opposite directions, and a phone in front flips through stories.
// Only transform and opacity change; images are small WebP files (8 to 26 KB) loaded lazily.

type Post = { id: string; alt: string };

const POSTS: Post[] = [
  { id: "salon", alt: "Salon post: “New week, new look”, book your braids before Friday" },
  { id: "cafe", alt: "Café post: “Weekend brunch is back”, from 6,000 RWF" },
  { id: "hardware", alt: "Hardware store post: “In stock: 20 L paint, white or cream”" },
  { id: "school", alt: "School post: “Open day for new parents”, Saturday at 10 am" },
  { id: "construction", alt: "Construction post: “Project complete”, three floors handed over on time" },
  { id: "phones", alt: "Phone shop post: “New smartphones in stock”" },
  { id: "tips", alt: "Salon tip post: “Keep your braids neat for longer”" },
  { id: "music", alt: "Restaurant post: “Live music on Friday nights”, from 7 pm" },
  { id: "features", alt: "Shop post: “Why customers come back”: fair prices, fast delivery, friendly staff" },
  { id: "clinic", alt: "Clinic post: “Book your check-up this month”" },
  { id: "sunday", alt: "Business post: “Now open on Sundays”, from 10 am" },
  { id: "gym", alt: "Gym post: “New morning class”, first class free" },
];

const ROWS = [POSTS.slice(0, 4), POSTS.slice(4, 8), POSTS.slice(8, 12)];
const STORIES = ["salon", "phones", "cafe", "hardware"];

export function PostShowcase() {
  const ref = useRef<HTMLElement>(null);
  const onProgress = useCallback((p: number) => {
    const el = ref.current;
    writeProgressVar(el, p);
    // The phone shows one story per quarter of the scroll, after the wall has settled.
    const story = String(Math.min(STORIES.length - 1, Math.max(0, Math.floor(((p - 0.2) / 0.75) * STORIES.length))));
    if (el && el.dataset.story !== story) el.dataset.story = story;
  }, []);
  useScrollProgress(ref, onProgress);

  return (
    <>
    <section ref={ref} id="designs" aria-labelledby="designs-title" data-scene="violet" data-story="0" className="sc scene-dark scroll-mt-24">
      <div className="sc-stage">
        <div className="sc-wall-wrap">
          <div className="sc-wall">
            {ROWS.map((row, r) => (
              <ul key={r} className="sc-row" style={{ ["--dir" as string]: r % 2 === 0 ? 1 : -1 }}>
                {/* Each row twice, so it never runs out while it drifts; the copy is hidden from screen readers. */}
                {[0, 1].map((copy) =>
                  row.map((post) => (
                    <li key={`${copy}-${post.id}`} className="sc-card" aria-hidden={copy === 1 || undefined}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- small pre-sized WebP posts; next/image would add a request per size for no gain */}
                      <img src={`/marketing/posts/${post.id}.webp`} alt={copy === 0 ? post.alt : ""} width={540} height={675} loading="lazy" decoding="async" />
                    </li>
                  )),
                )}
              </ul>
            ))}
          </div>
        </div>

        <div className="sc-head">
          <p className="m-0 text-sm font-semibold tracking-[0.14em] text-new uppercase">Designs</p>
          <h2 id="designs-title" className="m-0 text-[clamp(30px,4.6vw,56px)] leading-[1.04] font-bold tracking-[-0.035em]">
            Posts in your brand. <span className="sc-grad">Made for you, every day.</span>
          </h2>
          <p className="m-0 max-w-xl text-[16px] leading-relaxed text-muted sm:text-lg">
            Offers, new stock, events, tips: BuPulse designs each post with your logo, your colours and your words, sized
            for the feed and for stories. Every picture on this wall came out of BuPulse’s own design engine.
          </p>
        </div>

        <div aria-hidden className="sc-phone">
          <div className="sc-screen">
            {STORIES.map((id, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- decorative story frames, pre-sized WebP
              <img key={id} src={`/marketing/posts/${id}-story.webp`} alt="" width={360} height={640} loading="lazy" decoding="async" data-i={i} />
            ))}
          </div>
        </div>
        <p className="sc-note m-0">Example posts for example businesses, made by BuPulse.</p>
      </div>
    </section>
    {/* After the wall lets go, the violet fades into the light page below. */}
    <div aria-hidden className="sc-tail" />
    </>
  );
}
