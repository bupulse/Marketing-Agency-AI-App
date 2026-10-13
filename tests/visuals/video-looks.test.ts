import { describe, expect, it } from "vitest";
import { drawFrame } from "@/components/visuals/video-renderer";
import { contrastRatio } from "@/lib/color-contrast";
import { PACKS } from "@/lib/designs/packs";
import { sceneStarts, transitionAt, wordsShown } from "@/lib/visuals/timeline";
import type { VideoPlan } from "@/lib/visuals/types";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import {
  captionPaint,
  chooseVideoLook,
  getVideoLook,
  isVideoLookId,
  lookColors,
  priceIn,
  sceneLayout,
  VIDEO_LOOKS,
  videoLookCounts,
  type VideoLayout,
} from "@/lib/visuals/video-looks";

const BRANDS: VideoPlan["colors"][] = [
  { background: "#101820", text: "#FFFFFF", accent: "#FF6A00", highlight: "#FFD23F" },
  { background: "#0A1F14", text: "#FFFFFF", accent: "#F4F1DE" },
  { background: "#1B1035", text: "#FFFFFF", accent: "#7B5CFF", highlight: "#7B5CFF" },
  { background: "#222222", text: "#FFFFFF", accent: "#777777", highlight: "#888888" },
];
const LAYOUTS: VideoLayout[] = ["lower-third", "kinetic", "framed", "split", "card", "steps", "quote", "price", "outro"];

describe("video looks registry", () => {
  it("has at least 10 looks per style, with unique ids", () => {
    const counts = videoLookCounts();
    for (const p of PACKS) expect(counts[p.id]).toBeGreaterThanOrEqual(10);
    expect(new Set(VIDEO_LOOKS.map((l) => l.id)).size).toBe(VIDEO_LOOKS.length);
    for (const l of VIDEO_LOOKS) {
      expect(l.id).toMatch(new RegExp(`^${l.style}/v-\\d{2}$`));
      expect(getVideoLook(l.id)).toBe(l);
      expect(isVideoLookId(l.id)).toBe(true);
      expect(l.motion.zoom).toBeGreaterThanOrEqual(1.06);
      expect(l.motion.zoom).toBeLessThanOrEqual(1.2);
    }
    expect(isVideoLookId("clean/v-99")).toBe(false);
    expect(getVideoLook(undefined)).toBeNull();
  });

  it("neighbouring looks of a style differ in family", () => {
    for (const p of PACKS) {
      const looks = VIDEO_LOOKS.filter((l) => l.style === p.id);
      for (let i = 1; i < looks.length; i++) expect(looks[i].family).not.toBe(looks[i - 1].family);
    }
  });

  it("captions always contrast with their box or background, or sit on a scrim over a photo", () => {
    for (const look of VIDEO_LOOKS) for (const colors of BRANDS) for (const layout of LAYOUTS) for (const hasPhoto of [false, true]) {
      const paint = captionPaint(look, layout, colors, hasPhoto);
      const c = lookColors(look, colors);
      if (paint.scrim) {
        expect(hasPhoto).toBe(true);
        expect(paint.text).toBe("#FFFFFF");
      } else {
        expect(contrastRatio(paint.text, paint.box ?? c.background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.onBackground, c.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("chooseVideoLook", () => {
  it("is deterministic and stays in the style", () => {
    const a = chooseVideoLook({ style: "earthy", angle: "promo", hasPhoto: true, recent: [], seed: "c1" });
    expect(a).toBe(chooseVideoLook({ style: "earthy", angle: "promo", hasPhoto: true, recent: [], seed: "c1" }));
    expect(a.startsWith("earthy/")).toBe(true);
    expect(getVideoLook(a)!.fits).toContain("promo");
  });

  it("avoids recent looks and the newest look's family", () => {
    const first = chooseVideoLook({ style: "bold", angle: "promo", hasPhoto: true, recent: [], seed: "x" });
    const next = chooseVideoLook({ style: "bold", angle: "promo", hasPhoto: true, recent: [first], seed: "x" });
    expect(next).not.toBe(first);
    expect(getVideoLook(next)!.family).not.toBe(getVideoLook(first)!.family);
  });

  it("skips photo looks without photos and prefers steps for tips", () => {
    for (const p of PACKS) {
      const id = chooseVideoLook({ style: p.id, hasPhoto: false, recent: [], seed: p.id });
      expect(getVideoLook(id)!.needsPhoto).toBe(false);
    }
    const tips = chooseVideoLook({ style: "fresh", angle: "tips", hasPhoto: true, sceneCount: 6, recent: [] });
    expect(getVideoLook(tips)!.fits).toContain("tips");
  });

  it("varies with the seed", () => {
    const ids = new Set(Array.from({ length: 20 }, (_, i) => chooseVideoLook({ style: "clean", hasPhoto: true, recent: [], seed: `s${i}` })));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("scene layouts", () => {
  it("finds prices and amounts", () => {
    expect(priceIn("Only RWF 15,000 this week")).toBe("RWF 15,000");
    expect(priceIn("Now 20% off")).toBe("20%");
    expect(priceIn("From $9")).toBe("$9");
    expect(priceIn("Open 7 days a week")).toBeNull();
  });

  it("outro closes, hook follows the look, a price makes a price card", () => {
    const look = VIDEO_LOOKS[0];
    expect(sceneLayout(look, { role: "cta", text: "Visit us" })).toBe("outro");
    expect(sceneLayout(look, { role: "hook", text: "Hi" })).toBe(look.layouts.hook);
    expect(sceneLayout(look, { role: "body", text: "Only 5,000 RWF" })).toBe("price");
    expect(sceneLayout(look, { role: "body", text: "Come early" })).toBe(look.layouts.body);
  });
});

describe("transitions", () => {
  it("start hidden or off-frame and end in place", () => {
    expect(transitionAt("crossfade", 0, 1080, 1920).alpha).toBe(0);
    expect(transitionAt("slide", 0, 1080, 1920).dx).toBe(1080);
    expect(transitionAt("slide", 1, 1080, 1920).dx).toBe(0);
    expect(transitionAt("zoom", 0, 1080, 1920).scale).toBeCloseTo(1.15);
    expect(transitionAt("zoom", 1, 1080, 1920)).toMatchObject({ alpha: 1, scale: 1 });
    expect(transitionAt("wipe", 0, 1080, 1920).clip!.w).toBe(0);
    expect(transitionAt("wipe", 1, 1080, 1920).clip!.w).toBe(1080);
  });

  it("kinetic words arrive by halfway", () => {
    expect(wordsShown(6, 0)).toBe(1);
    expect(wordsShown(6, 0.25)).toBe(3);
    expect(wordsShown(6, 0.5)).toBe(6);
    expect(wordsShown(0, 1)).toBe(0);
  });
});

describe("buildVideoPlan with a look", () => {
  const input = { script: "Fresh bread daily\nOnly RWF 2,000 a loaf\nOrder by phone", hook: "Warm bread", businessName: "Sunrise Bakery", photos: ["u/a.jpg"], pack: "warm" as const, colors: ["#E4572E", "#F3A712", "#2E86AB"] };

  it("records the look, its transition length and motions, contact and logo", () => {
    const look = VIDEO_LOOKS.find((l) => l.style === "warm")!;
    const plan = buildVideoPlan({ ...input, look: look.id, contact: "+250 788 000 000", logoPath: "u/logo.png" });
    expect(plan.look).toBe(look.id);
    expect(plan.crossfadeMs).toBe(look.transition.ms);
    expect(plan.scenes[0].motion).toBe(look.motion.sequence[0]);
    expect(plan).toMatchObject({ contact: "+250 788 000 000", logoPath: "u/logo.png" });
    expect(plan.colors.highlight).toBeTruthy();
    expect(plan.totalMs).toBeGreaterThanOrEqual(10_000);
    expect(plan.totalMs).toBeLessThanOrEqual(30_000);
  });

  it("ignores an unknown look and keeps the classic plan", () => {
    const plan = buildVideoPlan({ ...input, look: "nope/v-01" });
    expect(plan.look).toBeUndefined();
    expect(plan.crossfadeMs).toBe(500);
    expect(plan.colors.highlight).toBeUndefined();
  });
});

/** A 2D context that records every call; any method exists. */
function recordingContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "measureText") return (s: string) => ({ width: s.length * 30 });
      if (prop === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("rendering a look", () => {
  const image = { width: 2000, height: 3000 } as unknown as HTMLImageElement;

  it("draws every look's scenes, transitions and captions without throwing", () => {
    for (const look of VIDEO_LOOKS) {
      const plan = buildVideoPlan({ script: "Step one is easy\nPay just $5 today\nStep three: enjoy", hook: "Three easy steps", businessName: "Nova Shop", photos: ["a.jpg"], pack: look.style, colors: ["#FF6A00"], look: look.id, contact: "nova.rw" });
      const starts = sceneStarts(plan);
      for (const [i, s] of starts.entries()) {
        for (const dt of [plan.crossfadeMs / 2, plan.crossfadeMs + 900]) {
          const { ctx } = recordingContext();
          expect(() => drawFrame(ctx, plan, new Map([["a.jpg", image]]), s + dt)).not.toThrow();
        }
        if (i === starts.length - 1) {
          const { ctx, calls } = recordingContext();
          drawFrame(ctx, plan, new Map(), plan.totalMs);
          const texts = calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
          // The outro: initial disc, business name and the contact line.
          expect(texts).toContain("N");
          expect(texts.some((t) => /nova shop/i.test(t))).toBe(true);
          expect(texts).toContain("nova.rw");
        }
      }
    }
  });

  it("writes one caption at a time and a price on its own card", () => {
    const look = VIDEO_LOOKS.find((l) => l.style === "vibrant" && l.layouts.body === "lower-third")!;
    const plan = buildVideoPlan({ script: "Only RWF 15,000 today", hook: "Big sale", businessName: "Nova", photos: ["a.jpg"], pack: "vibrant", colors: ["#FF2E63"], look: look.id });
    const i = plan.scenes.findIndex((s) => s.text.includes("15,000"));
    const { ctx, calls } = recordingContext();
    drawFrame(ctx, plan, new Map([["a.jpg", image]]), sceneStarts(plan)[i] + plan.crossfadeMs + 900);
    const texts = calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    expect(texts).toContain("RWF 15,000");
    expect(texts.some((t) => /big sale/i.test(t))).toBe(false);
  });
});
