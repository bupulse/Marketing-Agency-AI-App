"use client";

import { ArrowDown, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { CtaButton, ForCta } from "@/components/marketing/quote/cta";
import { FRAME_COUNT, beatAt, frameAt, frameSrc, loadOrder } from "./hero-frames";
import { prefersReducedMotion, useScrollProgress, writeProgressVar } from "./scroll-scene";
import "./motion.css";

/*
 * The home page's opening scene: a presenter who turns into an android as you scroll, then "It was AI all along".
 *
 * The frames are 36 stills from BuPulse's own ad "Who's real?" (made with an AI presenter, 10 November 2026), cropped
 * above its captions (public/marketing/avatar, made by the ffmpeg steps in docs/design/front-page-motion.md). They are
 * drawn on a canvas as the visitor scrolls: sparse before and after the change, dense through the 0.5 s glitch, so
 * the transformation takes most of the scroll.
 *
 * Loading: the first frame is a normal <img> (the page's largest image, fetched first). The other 35 load after the
 * page is idle or on the first scroll or touch, in an order that fills the timeline evenly (first, last, middle,
 * quarters...), so a fast scroll always finds a near frame. Phones get 360x420 frames (about 430 KB for all of them),
 * wider screens 600x700 (about 820 KB).
 *
 * Reduced motion: no pinning and no canvas; the portrait is split down the middle, half presenter, half android.
 */

export function AvatarHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef<(HTMLImageElement | null)[]>(Array(FRAME_COUNT).fill(null));
  const target = useRef(0);
  const shown = useRef(0);
  const drawn = useRef(-1);
  const loop = useRef(0);

  const draw = useCallback((position: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const want = Math.round(position);
    // The nearest frame that has arrived, searching outwards.
    let idx = -1;
    for (let d = 0; d < FRAME_COUNT; d++) {
      if (images.current[want - d]) {
        idx = want - d;
        break;
      }
      if (images.current[want + d]) {
        idx = want + d;
        break;
      }
    }
    if (idx < 0 || idx === drawn.current) return;
    const img = images.current[idx]!;
    if (canvas.width !== img.naturalWidth) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawn.current = idx;
    if (idx > 0) sectionRef.current?.setAttribute("data-canvas", "on");
  }, []);

  // Eases the shown frame towards the scroll position, so a mouse wheel's big steps still play every frame.
  // One requestAnimationFrame loop at most, running only until the shown frame has caught up.
  const animate = useCallback(() => {
    if (loop.current) return;
    function step() {
      loop.current = 0;
      const diff = target.current - shown.current;
      shown.current = Math.abs(diff) < 0.05 ? target.current : shown.current + diff * 0.24;
      draw(shown.current);
      if (shown.current !== target.current) loop.current = requestAnimationFrame(step);
    }
    loop.current = requestAnimationFrame(step);
  }, [draw]);

  const onProgress = useCallback(
    (p: number) => {
      const el = sectionRef.current;
      writeProgressVar(el, p);
      const beat = beatAt(p);
      if (el && el.dataset.beat !== beat) el.dataset.beat = beat;
      target.current = frameAt(p);
      animate();
    },
    [animate],
  );

  useScrollProgress(sectionRef, onProgress);

  // Load the frames once the page is idle, or at the first sign the visitor is about to scroll.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const set: "m" | "d" = window.matchMedia("(min-width: 768px)").matches ? "d" : "m";
    let cancelled = false;
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      cleanupTriggers();
      const queue = loadOrder(FRAME_COUNT);
      // Four at a time: steady progress without crowding a slow phone connection.
      const next = () => {
        const i = queue.shift();
        if (i === undefined || cancelled) return;
        const img = new Image();
        img.decoding = "async";
        img.src = frameSrc(set, i);
        img
          .decode()
          .then(() => {
            if (cancelled) return;
            images.current[i] = img;
            // A newly arrived frame may be nearer to the scroll position than the one on screen.
            drawn.current = -1;
            animate();
          })
          .catch(() => {})
          .finally(next);
      };
      for (let k = 0; k < 4; k++) next();
    };
    const triggers = ["scroll", "wheel", "touchstart", "pointerdown", "keydown"] as const;
    const cleanupTriggers = () => triggers.forEach((t) => window.removeEventListener(t, begin));
    triggers.forEach((t) => window.addEventListener(t, begin, { passive: true, once: true }));
    const idle = window.setTimeout(() => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(begin, { timeout: 2000 });
      else begin();
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(idle);
      cleanupTriggers();
      cancelAnimationFrame(loop.current);
      loop.current = 0;
    };
  }, [animate]);

  return (
    <section ref={sectionRef} aria-labelledby="hero-title" className="ah" data-beat="1">
      <div className="ah-stage">
        <div aria-hidden className="ah-screen">
          <div className="ah-glow ah-glow-a" />
          <div className="ah-glow ah-glow-b" />
        </div>
        <div className="ah-inner">
          <div className="ah-copy">
            <p className="ah-eyebrow">
              <span aria-hidden className="size-2 shrink-0 animate-ping-soft rounded-full bg-pulse-blue" />
              The marketing team for every small business
            </p>
            <h1 id="hero-title" className="ah-title">
              Your business, <span className="ah-title-grad">marketed every day.</span>
            </h1>
            <p className="ah-lead">
              BuPulse writes and designs your posts, makes your videos and answers the people who visit your website, so
              customers keep finding you while you run the business.
            </p>
          </div>

          <div className="ah-cta">
            <div className="ah-actions">
              <CtaButton size="lg" trailing={<ArrowRight aria-hidden className="size-[18px]" />} />
              <Button href="#how" variant="outline" size="lg" className="ah-ghost">
                See how it works
              </Button>
            </div>
            <p className="ah-note">
              <ForCta
                trial="Free trial, no card needed · Cancel any time"
                quote="Free quote · We call you back · Pay by Mobile Money or card"
              />
            </p>
          </div>

          <figure className="ah-figure" aria-labelledby="hero-beats">
            <div className="ah-frame">
              <picture>
                <source media="(min-width: 768px)" srcSet="/marketing/avatar/d00.webp" width={600} height={700} />
                <img
                  src="/marketing/avatar/m00.webp"
                  width={360}
                  height={420}
                  alt="A young man in a light shirt talks to the camera, like a customer filming a phone video."
                  fetchPriority="high"
                  className="ah-img"
                />
              </picture>
              {/* Reduced motion: the right half shows the same presenter as an android. */}
              <picture className="ah-after">
                <source media="(min-width: 768px)" srcSet="/marketing/avatar/d35.webp" width={600} height={700} />
                <img src="/marketing/avatar/m35.webp" width={360} height={420} alt="" loading="lazy" className="ah-img" />
              </picture>
              <canvas ref={canvasRef} aria-hidden className="ah-canvas" width={360} height={420} />
              <div aria-hidden className="ah-hud">
                <span className="ah-corner ah-corner-tl" />
                <span className="ah-corner ah-corner-tr" />
                <span className="ah-corner ah-corner-bl" />
                <span className="ah-corner ah-corner-br" />
                <span className="ah-tag ah-tag-scan">Scanning</span>
                <span className="ah-tag ah-tag-ai">
                  AI presenter<span className="ah-tag-more"> · made by BuPulse</span>
                </span>
              </div>
              {/* The story, told in three beats that cross-fade as you scroll (all three are in the HTML). */}
              <div className="ah-beats" id="hero-beats">
                <p className="ah-beat" data-n="1">
                  <strong>Meet your new presenter.</strong> He talks about your products, your prices and your offer,
                  filmed like the phone videos people actually watch.
                </p>
                <p className="ah-beat" data-n="2">
                  <strong>Now look closer.</strong> Keep scrolling.
                </p>
                <p className="ah-beat" data-n="3">
                  <strong>It was AI all along.</strong> BuPulse makes realistic AI presenter videos that market your
                  business. No camera, no studio, no actor to book.
                </p>
              </div>
            </div>
          </figure>
        </div>
        <a href="#ai-videos" className="ah-next">
          <span>Watch the whole ad</span>
          <ArrowDown aria-hidden className="size-4" />
        </a>
      </div>
    </section>
  );
}
