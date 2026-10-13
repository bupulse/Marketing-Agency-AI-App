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
  it("keeps a sound answer: pack, template, texts; the album photo is shown as it is when AI photos are off", () => {
    const plan = validateDirection({ format: "single", pack: "warm", slides: [slide({ chip: "RWF 45,000" })] }, ctx({ aiAllowed: false }));
    expect(plan.directedBy).toBe("ai");
    expect(plan.pack).toBe("warm");
    expect(plan.slides).toHaveLength(1);
    expect(plan.slides[0]).toMatchObject({ template: "new-arrival", headline: "Light and bold", chip: "RWF 45,000", source: "album", photoPath: jpg(1), designId: null, path: null });
    expect(plan.people).toBeUndefined();
  });

  it("posts show people: with AI allowed the cover is an AI scene with people, the album photo its product reference", () => {
    const people = { who: "a woman in her thirties", doing: "lacing the sneakers", where: "a running track in Kigali", mood: "energetic", framing: "full body" };
    const plan = validateDirection({ format: "single", pack: "bold", slides: [slide()], people }, ctx({ audience: { country: "Rwanda", personas: [] } }));
    expect(plan.slides[0]).toMatchObject({ source: "ai", photoPath: jpg(1) });
    expect(plan.people).toEqual(people);
    expect(plan.slides[0].scene).toMatch(/a woman in her thirties, Rwandan people in natural everyday clothes; lacing the sneakers; in a running track in Kigali/);
    expect(plan.slides[0].scene).toMatch(/reference photo appears exactly as it is/);
  });

  it("the rare exceptions keep no people: quote cards, designed slides, or AI not allowed", () => {
    const quote = validateDirection({ format: "single", pack: "clean", slides: [slide({ template: "quote", image: "none" })] }, ctx());
    expect(quote.slides[0].source).not.toBe("ai");
    const prices = validateDirection({ format: "single", pack: "clean", slides: [slide({ template: "offer", image: "none" })] }, ctx());
    expect(prices.slides[0].source).toBe("text");
  });

  it("a missing or unsafe people brief is written by BuPulse from the country and personas", () => {
    const audience = { country: "Kenya", personas: [{ ageRange: "25-34", gender: "female", location: "Nairobi", occupation: "nurse" }] };
    const missing = validateDirection({ format: "single", pack: "clean", slides: [slide({ image: "ai" })] }, ctx({ audience }));
    expect(missing.people?.who).toBe("one or two Kenyan women in their late twenties or thirties, such as a nurse");
    const unsafe = validateDirection({ format: "single", pack: "clean", slides: [slide({ image: "ai" })], people: { who: "a famous singer lookalike with kids", doing: "", where: "", mood: "", framing: "" } }, ctx({ audience }));
    expect(unsafe.people?.who).not.toMatch(/famous|singer|lookalike|kids/i);
  });

  it("a carousel with an AI cover uses one AI image: the other slides are designed over the cover photo", () => {
    const three = [slide({ image: "ai" }), slide({ headline: "Tip 1", image: "none", template: "announcement" }), slide({ headline: "Tip 2", image: "none", template: "new-arrival" })];
    const plan = validateDirection({ format: "carousel", pack: "clean", slides: three }, ctx({ photos: [] }));
    expect(plan.slides.map((s) => s.source)).toEqual(["ai", "text", "text"]);
    expect(plan.slides.slice(1).every((s) => s.useCoverPhoto && s.template === "announcement")).toBe(true);
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
    expect(allowed.slides[0]).toMatchObject({ source: "ai", photoPath: jpg(1) });
    expect(allowed.slides[0].scene).toMatch(/runner at dawn/);

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
    // The cover is a people photo with the product as reference; the tips are designed over it (one AI image).
    expect(plan.slides[0]).toMatchObject({ source: "ai", chip: "RWF 45,000", photoPath: jpg(1) });
    expect(plan.slides.slice(1).every((s) => s.source === "text" && s.useCoverPhoto)).toBe(true);
    expect(plan.people?.who).toMatch(/adults/);
    const free = fallbackPlan(ctx({ caption: tips, aiAllowed: false }));
    expect(free.slides[0]).toMatchObject({ source: "album" });
  });

  it("no photos and no AI: a single free text design", () => {
    const plan = fallbackPlan(ctx({ photos: [], aiAllowed: false }));
    expect(plan.slides).toHaveLength(1);
    expect(plan.slides[0]).toMatchObject({ source: "text", template: "announcement" });
  });

  it("no photos but AI allowed: one AI photo scene", () => {
    const plan = fallbackPlan(ctx({ photos: [] }));
    expect(plan.slides[0]).toMatchObject({ source: "ai", photoPath: null });
    expect(plan.slides[0].scene).toMatch(/using or enjoying Aero Sneaker/);
    expect(plan.slides[0].scene).not.toMatch(/reference photo/);
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

describe("people briefs", () => {
  it("look local: Rwanda means Rwandans in Kigali; other countries are named; under-18 personas still give adults", async () => {
    const { defaultPeople, localLook, peopleScene } = await import("@/lib/visuals/people");
    expect(localLook("Rwanda")).toEqual({ people: "Rwandan", place: "Kigali" });
    expect(localLook("Peru")).toEqual({ people: "local", place: "Peru" });
    const teen = defaultPeople({ country: "Rwanda", personas: [{ ageRange: "under-18", gender: "any" }] }, "school bags");
    expect(teen.who).toBe("one or two Rwandan adults");
    const scene = peopleScene(null, { country: "Rwanda", personas: [] }, "the phone", true);
    expect(scene).toMatch(/Rwandan adults/);
    expect(scene).toMatch(/Kigali/);
    expect(scene).not.toMatch(/\b(text|caption|headline)\b/i);
  });
});
