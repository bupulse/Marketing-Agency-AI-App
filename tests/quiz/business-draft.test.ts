import { describe, expect, it } from "vitest";
import { summarySchema } from "@/lib/knowledge/interview";
import { factsOf, invents, parseDraft, sanitizeDraft, templateDraft, type AiDraft, type QuizContext, type QuizDraft } from "@/lib/knowledge/quiz-draft";

// Placeholder business (fixtures use fake names).
const ctx: QuizContext = {
  businessName: "Inzozi Bakery",
  industry: "Bakery",
  country: "Rwanda",
  area: "Kigali",
  about: "We bake bread and cakes every morning. Free delivery over 20,000 RWF.",
  audience: null,
  website: null,
  contentLanguage: "English",
  products: [{ name: "Sourdough loaf", kind: "PHYSICAL", summary: "Slow-baked bread", price: "3,500 RWF" }],
  personas: [],
  competitors: ["Supermarket bakery"],
  faqs: ["Do you deliver?"],
};
const template = templateDraft(ctx);

const voice = (name: string) => ({ name, voice: `${name} voice for the bakery.`, do: ["Be warm"], dont: ["Be rude"], sample: `Fresh bread today at Inzozi Bakery (${name}).` });
const good: AiDraft = {
  taglines: ["Bread with love", "Bread with love", "Baked fresh since 1999", "Kigali's morning bread"],
  about: "Inzozi Bakery bakes bread and cakes every morning in Kigali.",
  missions: ["To put fresh bread on every table."],
  values: ["Freshness", "Family"],
  languages: ["Kinyarwanda", "English"],
  products: [
    { name: "Sourdough loaf", kind: "PHYSICAL", summary: "Duplicate", reasons: ["Tasty"] },
    { name: "Birthday cake", kind: "PHYSICAL", summary: "Cakes made to order for 5,000 RWF.", reasons: ["Made to order", "Only 2,000 RWF"] },
  ],
  personas: [{ name: "Office worker", ageRange: "25-34", gender: "any", location: "Kigali", occupation: "Office worker", needs: ["Quick breakfast"], pains: ["Queues"], triggers: ["Smell of fresh bread"], channels: ["WhatsApp", "MySpace"] }],
  competitors: ["Supermarket bakery", "Street sellers"],
  differentiators: ["Baked every morning", "Guaranteed freshest in Rwanda"],
  positioning: ["For families in Kigali who want fresh bread, Inzozi Bakery bakes every morning."],
  faqs: [
    { question: "Do you deliver?", answer: "Yes." },
    { question: "Can I order a cake?", answer: "Yes, free delivery over 20,000 RWF." },
    { question: "Do you open at 6 am?", answer: "Yes, from 6 am." },
  ],
  policies: { delivery: ["We deliver in Kigali", "Delivery takes 30 minutes"], returns: ["50% refund"], booking: [], payment: ["cash", "mtn_momo"] },
  voices: [voice("Warm"), { ...voice("Broken"), voice: "" }, voice("Professional")],
};

describe("never inventing", () => {
  const facts = factsOf(ctx);

  it("spots a number or a promise that is not in the data", () => {
    expect(invents("Only 2,000 RWF", facts)).toBe(true);
    expect(invents("Baked fresh since 1999", facts)).toBe(true);
    expect(invents("Guaranteed freshest", facts)).toBe(true);
    expect(invents("Sourdough for 3,500 RWF", facts)).toBe(false);
    expect(invents("Free delivery over 20,000 RWF", facts)).toBe(false);
    expect(invents("Bread with love", facts)).toBe(false);
  });
});

describe("sanitizeDraft", () => {
  const d = sanitizeDraft(good, ctx, template);

  it("drops invented facts and duplicates, and tops up from the template", () => {
    expect(d.source).toBe("ai");
    expect(d.taglines[0]).toBe("Bread with love");
    expect(d.taglines).not.toContain("Baked fresh since 1999");
    expect(d.taglines).toHaveLength(3);
    expect(new Set(d.taglines.map((t) => t.toLowerCase())).size).toBe(3);
    expect(d.differentiators).toContain("Baked every morning");
    expect(d.differentiators.some((x) => /guarantee/i.test(x))).toBe(false);
    expect(d.policies.delivery).not.toContain("Delivery takes 30 minutes");
    expect(d.policies.returns.some((r) => r.includes("%"))).toBe(false);
    expect(d.policies.booking).toEqual(template.policies.booking);
    expect(d.missions).toHaveLength(3);
  });

  it("keeps products and questions new, and never with a made-up price", () => {
    expect(d.products.map((p) => p.name)).toEqual(["Birthday cake"]);
    expect(d.products[0].summary).toBe(""); // the summary had a price that is not in the data
    expect(d.products[0].reasons[0]).toBe("Made to order");
    expect(d.products[0].reasons).not.toContain("Only 2,000 RWF");
    expect(d.faqs.map((f) => f.question)).not.toContain("Do you deliver?");
    expect(d.faqs.map((f) => f.question)).toContain("Can I order a cake?");
    expect(d.faqs.map((f) => f.question)).not.toContain("Do you open at 6 am?");
    expect(d.faqs).toHaveLength(5);
    expect(d.competitors).not.toContain("Supermarket bakery");
    expect(d.competitors[0]).toBe("Street sellers");
  });

  it("keeps persona channels to the known places and fills three personas", () => {
    expect(d.personas[0].channels).toContain("WhatsApp");
    expect(d.personas[0].channels).not.toContain("MySpace");
    expect(d.personas).toHaveLength(3);
  });

  it("gives three voices, each a full brand-voice summary with its sample", () => {
    expect(d.voices).toHaveLength(3);
    expect(d.voices.map((v) => v.label)).toEqual(["Warm", "Professional", template.voices[0].label]);
    for (const v of d.voices) {
      expect(summarySchema.safeParse(v.summary).success).toBe(true);
      expect(v.summary.samples).toEqual([v.sample]);
    }
    expect(new Set(d.voices.map((v) => v.id)).size).toBe(3);
  });

  it("anything off-shape is the template", () => {
    expect(sanitizeDraft({ taglines: "nope" }, ctx, template)).toBe(template);
    expect(sanitizeDraft(null, ctx, template)).toBe(template);
  });
});

describe("parseDraft", () => {
  it("reads JSON in a code fence, and falls back on garbage", () => {
    expect(parseDraft("```json\n" + JSON.stringify(good) + "\n```", ctx, template).source).toBe("ai");
    expect(parseDraft("Sorry, I can't help with that.", ctx, template)).toBe(template);
  });
});

describe("templateDraft", () => {
  // Every text the owner may keep (the age range is a choice from a list, not text).
  const strings = (d: QuizDraft) => JSON.stringify({ ...d, personas: d.personas.map((p) => ({ ...p, ageRange: "" })), voices: d.voices.map((v) => v.summary) }).match(/"(?:[^"\\]|\\.)*"/g) ?? [];

  it("fills every round without inventing a number or a promise", () => {
    const facts = factsOf(ctx);
    expect(template.source).toBe("template");
    expect(template.taglines).toHaveLength(3);
    expect(template.missions).toHaveLength(3);
    expect(template.personas).toHaveLength(3);
    expect(template.positioning).toHaveLength(3);
    expect(template.faqs.length).toBeGreaterThan(0);
    expect(template.voices).toHaveLength(3);
    for (const s of strings(template)) expect(invents(s, facts), s).toBe(false);
    for (const v of template.voices) expect(summarySchema.safeParse(v.summary).success).toBe(true);
  });

  it("uses the industry's kit, and leaves out questions already answered", () => {
    expect(template.values).toContain("Fresh every day");
    expect(template.faqs.map((f) => f.question)).not.toContain("Do you deliver?");
    const salon = templateDraft({ ...ctx, industry: "Hair salon", about: null, faqs: [] });
    expect(salon.faqs.map((f) => f.question)).toContain("Do I need to book?");
    const plain = templateDraft({ ...ctx, industry: null, about: null, country: null, area: null });
    expect(plain.taglines.every((t) => t.length > 0)).toBe(true);
    expect(plain.personas[0].location).toBe("Rwanda");
    expect(plain.languages).toEqual(["English"]);
  });
});
