import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FRAME_COUNT, beatAt, frameAt, frameSrc, loadOrder } from "@/components/marketing/home/hero-frames";
import { faqs, features } from "@/lib/content/site";

// The home page hero (components/marketing/home/avatar-hero.tsx, docs/design/front-page-motion.md): a presenter who
// turns into an android as you scroll, drawn from 36 stills of BuPulse's own "Who's real?" ad.
describe("home page hero frames", () => {
  it("loads every frame exactly once, first and last first, then filling the timeline evenly", () => {
    const order = loadOrder(FRAME_COUNT);
    expect(order).toHaveLength(FRAME_COUNT);
    expect(new Set(order).size).toBe(FRAME_COUNT);
    expect(order.slice(0, 3)).toEqual([0, FRAME_COUNT - 1, Math.floor((FRAME_COUNT - 1) / 2)]);
    // After the first 8 loads, loaded frames are at most 10 apart (no part of the scroll is more than 5 from one).
    const first = order.slice(0, 8).sort((a, b) => a - b);
    const gaps = first.slice(1).map((n, i) => n - first[i]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(10);
    expect(loadOrder(1)).toEqual([0]);
    expect(loadOrder(0)).toEqual([]);
  });

  it("maps scroll to frames and story beats, holding the reveal at the end", () => {
    expect(frameAt(0)).toBe(0);
    expect(frameAt(0.08)).toBe(0);
    expect(frameAt(0.78)).toBeCloseTo(FRAME_COUNT - 1);
    expect(frameAt(1)).toBe(FRAME_COUNT - 1);
    expect(beatAt(0)).toBe("1");
    expect(beatAt(0.4)).toBe("2");
    expect(beatAt(0.9)).toBe("3");
  });

  it("ships every phone and desktop frame, small enough for a phone in Rwanda", () => {
    let phoneBytes = 0;
    for (let i = 0; i < FRAME_COUNT; i++) {
      for (const set of ["m", "d"] as const) {
        const file = path.join(process.cwd(), "public", frameSrc(set, i));
        expect(existsSync(file), file).toBe(true);
        if (set === "m") phoneBytes += statSync(file).size;
      }
    }
    // The brief: hero media under about 1.5 MB on phones.
    expect(phoneBytes).toBeLessThan(1_500_000);
  });
});

describe("home page claims", () => {
  it("never promise AI Kinyarwanda voices (owner, 31 October 2026: real Rwandan voices only)", () => {
    const kin = faqs.find((f) => /kinyarwanda/i.test(f.q));
    expect(kin?.a).toMatch(/not good enough in Kinyarwanda/);
    expect(kin?.a).toMatch(/real Rwandan voice/);
  });

  it("no longer call video 'coming soon': slideshow videos are built, AI presenter ads are on request", () => {
    const video = features.find((f) => /video/i.test(f.title));
    expect(video?.soon).toBeFalsy();
    expect(video?.note).toBe("Not in every plan");
  });
});
