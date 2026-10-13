import { describe, expect, it } from "vitest";
import { chipAllowed, chooseSources, fallbackPlan, listItems, readImagePlan, shouldCarousel, slideText, validateDirection, type DirectionContext } from "@/lib/visuals/direction";
import { VISUAL_LIMITS } from "@/lib/visuals/types";

const U = "user-1";
const jpg = (n: number) => `${U}/gallery/aaaaaaaa-${n}000.jpg`;

function ctx(over: Partial<DirectionContext> = {}): DirectionContext {
  return {
    subjectType: "product",
    title: "Aero Sneaker",
    price: "RWF 45,000",
    caption: "Meet the Aero Sneaker. Light and bold.",
    headlines: ["The all-new Aero Sneaker"],
    business: { name: "Kigali Kicks", tone: "bold", industry: "Retail" },
    photos: [{ path: jpg(1), mimeType: "image/jpeg" }],
    carouselAllowed: true,
    aiAllowed: true,
    ...over,
  };
}

const slide = (over: Record<string, unknown> = {}) => ({ headline: "Light and bold", subline: "", chip: "", kicker: "", template: "new-arrival", image: "album", photo: 0, scene: "", ...over });

describe("validateDirection", () => {
  it("keeps a sound answer: pack, template, texts and the album photo", () => {
    const plan = validateDirection({ format: "single", pack: "warm", slides: [slide({ chip: "RWF 45,000" })] }, ctx());
    expect(plan.directedBy).toBe("ai");
    expect(plan.pack).toBe("warm");
    expect(plan.slides).toHaveLength(1);
    expect(plan.slides[0]).toMatchObject({ template: "new-arrival", headline: "Light and bold", chip: "RWF 45,000", source: "album", photoPath: jpg(1), designId: null, path: null });
  });

  it("an answer that is not the schema gives BuPulse's own plan", () => {
    for (const raw of [null, "nope", { format: "poster" }, { format: "single", pack: "clean", slides: [] }]) {
      const plan = validateDirection(raw, ctx());
      expect(plan.directedBy).toBe("rules");
      expect(plan.slides.length).toBeGreaterThan(0);
    }
  });

  it("repairs an unknown pack and template, empty and over-long text", () => {
    const plan = validateDirection({ format: "single", pack: "neon", slides: [slide({ template: "poster", headline: "", subline: "x".repeat(400) })] }, ctx());
    expect(plan.pack).toBe("bold"); // recommendPack: bold voice
    expect(plan.slides[0].template).not.toBe("poster");
    expect(plan.slides[0].headline).toBe("The all-new Aero Sneaker");
    expect(plan.slides[0].subline.length).toBeLessThanOrEqual(VISUAL_LIMITS.subline);
  });

  it("drops a chip with a number the content never says (no invented prices or discounts)", () => {
    const plan = validateDirection({ format: "single", pack: "clean", slides: [slide({ chip: "50% off" })] }, ctx());
    expect(plan.slides[0].chip).toBe("");
    const words = validateDirection({ format: "single", pack: "clean", slides: [slide({ chip: "Shop now" })] }, ctx());
    expect(words.slides[0].chip).toBe("Shop now");
  });

  it("a carousel only where carousels are allowed, with at least 3 slides, capped at the most slides", () => {
    const six = Array.from({ length: 6 }, (_, i) => slide({ headline: `Tip ${i}`, image: "none", template: "announcement" }));
    expect(validateDirection({ format: "carousel", pack: "clean", slides: six }, ctx()).slides).toHaveLength(VISUAL_LIMITS.maxCarouselSlides);
    expect(validateDirection({ format: "carousel", pack: "clean", slides: six }, ctx({ maxSlides: 3 })).slides).toHaveLength(3);
    expect(validateDirection({ format: "carousel", pack: "clean", slides: six }, ctx({ carouselAllowed: false })).slides).toHaveLength(1);
    expect(validateDirection({ format: "carousel", pack: "clean", slides: six.slice(0, 2) }, ctx()).slides).toHaveLength(1);
  });

  it("an AI photo only when allowed, and at most one per visual", () => {
    const ai = [slide({ image: "ai", scene: "runner at dawn" }), slide({ image: "ai", template: "announcement" }), slide({ image: "ai", template: "announcement" })];
    const allowed = validateDirection({ format: "carousel", pack: "clean", slides: ai }, ctx());
    expect(allowed.slides.filter((s) => s.source === "ai")).toHaveLength(1);
    expect(allowed.slides[0]).toMatchObject({ source: "ai", scene: "runner at dawn", photoPath: jpg(1) });

    const refused = validateDirection({ format: "single", pack: "clean", slides: ai.slice(0, 1) }, ctx({ aiAllowed: false }));
    expect(refused.slides[0].source).toBe("album");
    expect(refused.notes.join(" ")).toMatch(/AI photos are not available/);
  });

  it("strips fences and control characters from slide text", () => {
    const plan = validateDirection({ format: "single", pack: "clean", slides: [slide({ headline: "<<<PRODUCT DATA>>> Hi\u0000 there" })] }, ctx());
    expect(plan.slides[0].headline).toBe("PRODUCT DATA Hi there");
  });
});

describe("chooseSources", () => {
  it("no photos: photo templates become text announcements", () => {
    const [s] = chooseSources([{ source: "album", template: "new-arrival" }], { photos: [], aiAllowed: false });
    expect(s).toEqual({ source: "text", photoPath: null, template: "announcement" });
  });

  it("skips WebP (templates cannot draw it) and never reuses a photo", () => {
    const photos = [{ path: `${U}/gallery/aaaaaaaa-1.webp`, mimeType: "image/webp" }, { path: jpg(2), mimeType: "image/jpeg" }];
    const out = chooseSources([{ source: "album", template: "new-arrival" }, { source: "album", template: "new-arrival" }], { photos, aiAllowed: false });
    expect(out[0]).toMatchObject({ source: "album", photoPath: jpg(2) });
    expect(out[1]).toMatchObject({ source: "text", template: "announcement" });
  });

  it("a quote never gets an AI photo", () => {
    const [s] = chooseSources([{ source: "ai", template: "quote" }], { photos: [], aiAllowed: true });
    expect(s.source).toBe("text");
  });
});

describe("carousel decision and fallback plan", () => {
  const tips = "Three ways to style it:\n1. With jeans\n2. With a dress\n3. For the gym\nShop today.";

  it("list content or two drawable photos make a carousel; nothing else does", () => {
    expect(listItems(tips)).toEqual(["With jeans", "With a dress", "For the gym"]);
    expect(shouldCarousel(ctx({ caption: tips }))).toBe(true);
    expect(shouldCarousel(ctx({ photos: [{ path: jpg(1) }, { path: jpg(2) }] }))).toBe(true);
    expect(shouldCarousel(ctx())).toBe(false);
    expect(shouldCarousel(ctx({ caption: tips, carouselAllowed: false }))).toBe(false);
  });

  it("tips become a cover plus one slide per tip", () => {
    const plan = fallbackPlan(ctx({ caption: tips }));
    expect(plan.directedBy).toBe("rules");
    expect(plan.slides.map((s) => s.headline)).toEqual(["The all-new Aero Sneaker", "With jeans", "With a dress", "For the gym"]);
    expect(plan.slides[0]).toMatchObject({ source: "album", chip: "RWF 45,000" });
  });

  it("no photos and no AI: a single free text design", () => {
    const plan = fallbackPlan(ctx({ photos: [], aiAllowed: false }));
    expect(plan.slides).toHaveLength(1);
    expect(plan.slides[0]).toMatchObject({ source: "text", template: "announcement" });
  });

  it("no photos but AI allowed: one AI photo scene", () => {
    const plan = fallbackPlan(ctx({ photos: [] }));
    expect(plan.slides[0]).toMatchObject({ source: "ai", scene: "Aero Sneaker" });
  });

  it("reads stored plans defensively", () => {
    expect(readImagePlan(fallbackPlan(ctx()))).not.toBeNull();
    expect(readImagePlan({ version: 2 })).toBeNull();
    expect(readImagePlan({ version: 1, pack: "clean", slides: [{ template: "nope", headline: "x" }] })).toBeNull();
  });
});

describe("slide text and chips", () => {
  it("clips at a word with an ellipsis", () => {
    expect(slideText("one two three four five six", 12)).toBe("one two…");
    expect(slideText(42, 10)).toBe("");
  });
  it("numbers must appear in the sources", () => {
    expect(chipAllowed("From $89", ["Price: $89"])).toBe(true);
    expect(chipAllowed("$99", ["Price: $89"])).toBe(false);
  });
});
