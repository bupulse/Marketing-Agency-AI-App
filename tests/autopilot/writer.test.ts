import { describe, expect, it, vi } from "vitest";
import { AIProviderError, type TextProvider } from "@/lib/ai/types";
import { getIdea } from "@/lib/autopilot/playbook";
import { buildPrompt, factsText, numbersIn, SYSTEM, writeGroup, type WriteRequest } from "@/lib/autopilot/writer";

const request = (over: Partial<WriteRequest> = {}): WriteRequest => ({
  brand: { businessName: "Sunrise Bakery", industry: "Food", description: "Fresh bread every morning", tone: "friendly", contentLanguage: "French", knowledge: { hours: "Mon-Sat 7:00-18:00" }, ownerName: "Amina" },
  idea: getIdea("offer-promo")!,
  facts: { project: { type: "offer", title: "Croissant box", price: "5,000 RWF", features: ["6 croissants"] }, date: "2026-10-13" },
  targets: [
    { network: "linkedin", format: "POST" },
    { network: "instagram", format: "POST" },
  ],
  ...over,
});

const provider = (output: unknown): TextProvider => ({
  name: "test",
  generate: vi.fn(async () => ({ text: JSON.stringify(output), provider: "gemini", model: "m", usage: { inputTokens: 5, outputTokens: 5 } })),
});

const good = {
  image: { kicker: "Offre", headline: "Boîte de croissants", subline: "Frais chaque matin", chip: "5,000 RWF" },
  versions: [
    { network: "linkedin", title: "", text: "Une offre pour nos voisins.\n\nBoîte de croissants à 5,000 RWF. #boulangerie", hashtags: ["#boulangerie", "#kigali", "#pain", "#extra"] },
    { network: "instagram", title: "", text: "Croissants frais ! 🥐 #croissant", hashtags: ["croissant", "#pain", "#matin"] },
  ],
};

describe("writer prompt", () => {
  it("states the same fact rules as the studio writer", () => {
    expect(SYSTEM).toMatch(/never invent prices, numbers, dates/);
    expect(SYSTEM).toMatch(/Never write a quote or review/);
    expect(SYSTEM).toMatch(/Hashtags must not contain years/);
    expect(SYSTEM).toMatch(/Each network gets its own version/);
  });

  it("includes language, voice, facts, idea guidance and a brief per network", () => {
    const prompt = buildPrompt(request());
    expect(prompt).toMatch(/Write all content in French/);
    expect(prompt).toMatch(/Brand voice: Friendly/);
    expect(prompt).toMatch(/Price or offer: 5,000 RWF/);
    expect(prompt).toMatch(/Opening hours: Mon-Sat/);
    expect(prompt).toMatch(/Post idea: Offer or promotion/);
    expect(prompt).toMatch(/- linkedin: LinkedIn post/);
    expect(prompt).toMatch(/- instagram: Instagram caption/);
    expect(prompt).not.toMatch(/- tiktok/);
  });

  it("asks for an article, a script and the FAQ answer where relevant", () => {
    const article = buildPrompt(request({ idea: getIdea("li-thought-leadership")!, facts: { date: "2026-10-13" }, targets: [{ network: "linkedin", format: "ARTICLE" }] }));
    expect(article).toMatch(/LinkedIn article/);
    expect(article).toMatch(/350 to 600 words/);
    const script = buildPrompt(request({ idea: getIdea("reel-quick-tip")!, facts: { date: "2026-10-13" }, targets: [{ network: "tiktok", format: "SCRIPT" }] }));
    expect(script).toMatch(/TikTok video script/);
    expect(script).toMatch(/timestamped scenes/);
    const faq = buildPrompt(request({ idea: getIdea("faq-answer")!, facts: { date: "2026-10-13", faq: { question: "Do you deliver?", answer: "Yes, within Kigali." } } }));
    expect(faq).toMatch(/use only this\): Yes, within Kigali\./);
  });

  it("mentions the occasion and a regeneration's previous text", () => {
    const prompt = buildPrompt(request({ facts: { date: "2026-12-25", holiday: { name: "Christmas Day", date: "2026-12-25" } }, previousText: "Old text", instruction: "Shorter" }));
    expect(prompt).toMatch(/Occasion: Christmas Day/);
    expect(prompt).toMatch(/clearly different take/);
    expect(prompt).toMatch(/The owner asks: Shorter/);
  });
});

describe("writing a group", () => {
  it("returns one clean version per requested network", async () => {
    const result = await writeGroup(provider(good), request());
    const li = result.versions.find((v) => v.network === "linkedin")!;
    const ig = result.versions.find((v) => v.network === "instagram")!;
    expect(li.text).not.toMatch(/#/); // hashtags live in their own list
    expect(li.hashtags).toEqual(["#boulangerie", "#kigali", "#pain"]); // LinkedIn keeps three
    expect(ig.hashtags).toEqual(["#croissant", "#pain", "#matin"]);
    expect(li.title).toBeNull();
    expect(result.provider).toBe("gemini");
  });

  it("keeps an article's title and trims over-long text to the network limit", async () => {
    const long = "word ".repeat(1500);
    const result = await writeGroup(
      provider({ image: good.image, versions: [{ network: "linkedin", title: "Why fresh bread matters", text: long, hashtags: [] }] }),
      request({ idea: getIdea("li-thought-leadership")!, targets: [{ network: "linkedin", format: "ARTICLE" }] }),
    );
    expect(result.versions[0].title).toBe("Why fresh bread matters");
    expect(result.versions[0].text.length).toBeLessThanOrEqual(3000);
  });

  it("keeps a script's timestamps and inline text", async () => {
    const script = "Title: x\n0-3s: Hook #bread\n3-10s: Show the oven";
    const result = await writeGroup(
      provider({ image: good.image, versions: [{ network: "tiktok", title: "", text: script, hashtags: ["#bread", "#kigali", "#a", "#b", "#c", "#d", "#e"] }] }),
      request({ idea: getIdea("reel-quick-tip")!, targets: [{ network: "tiktok", format: "SCRIPT" }] }),
    );
    expect(result.versions[0].text).toBe(script);
    expect(result.versions[0].hashtags).toHaveLength(5);
  });

  it("drops image text that carries a number the facts do not contain", async () => {
    const result = await writeGroup(provider({ ...good, image: { kicker: "Offre", headline: "Boîte de croissants", subline: "Seulement 2 jours", chip: "-30%" } }), request());
    expect(result.image.headline).toBe("Boîte de croissants");
    expect(result.image.subline).toBe(""); // "2" is not in the facts
    expect(result.image.chip).toBe(""); // "30" is not either
    const ok = await writeGroup(provider(good), request());
    expect(ok.image.chip).toBe("5,000 RWF");
  });

  it("fails retryably, with the billed tokens, when the AI returns the wrong shape", async () => {
    await expect(writeGroup(provider({ nope: true }), request())).rejects.toMatchObject({ retryable: true, usage: { inputTokens: 5, outputTokens: 5 } });
    await expect(writeGroup(provider({ nope: true }), request())).rejects.toBeInstanceOf(AIProviderError);
  });

  it("fails when a network's version is missing or empty", async () => {
    const missing = { image: good.image, versions: [good.versions[0]] };
    await expect(writeGroup(provider(missing), request())).rejects.toThrow(/instagram/);
    const empty = { image: good.image, versions: [good.versions[0], { network: "instagram", title: "", text: "  ", hashtags: [] }] };
    await expect(writeGroup(provider(empty), request())).rejects.toThrow(/instagram/);
  });
});

describe("number helpers", () => {
  it("normalises separators", () => {
    expect(numbersIn("5,000 RWF and 485.000 and 20% off")).toEqual(["5000", "485000", "20"]);
  });
  it("collects the facts it was given", () => {
    expect(factsText(request())).toMatch(/5,000 RWF/);
  });
});
