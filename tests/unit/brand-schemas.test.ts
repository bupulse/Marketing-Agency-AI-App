import { describe, expect, it } from "vitest";
import { industries } from "@/lib/content/site";
import { industryOptions } from "@/lib/auth/schemas";
import {
  flatErrors,
  isOwnLogoPath,
  knowledgeSchema,
  lookSchema,
  offerSchema,
  prepareFaqs,
  readKnowledge,
  voiceSchema,
} from "@/lib/brand/schemas";
import { sampleTopic, voices } from "@/lib/brand/voices";

describe("offerSchema", () => {
  it("accepts a normal description and audience", () => {
    expect(offerSchema.safeParse({ description: "Fresh bread and cakes", audience: "Families nearby" }).success).toBe(true);
  });
  it("rejects short or missing text with plain messages", () => {
    const r = offerSchema.safeParse({ description: "Bread", audience: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(flatErrors(r.error))).toEqual(["description", "audience"]);
  });
});

describe("voiceSchema", () => {
  it("accepts every preset and rejects unknown ids", () => {
    for (const v of voices) expect(voiceSchema.safeParse({ tone: v.id }).success).toBe(true);
    expect(voiceSchema.safeParse({ tone: "sarcastic" }).success).toBe(false);
  });
});

describe("lookSchema", () => {
  it("allows no logo and no colours", () => {
    expect(lookSchema.safeParse({ brandColors: [] }).success).toBe(true);
  });
  it("uppercases hex colours and caps them at 3", () => {
    const ok = lookSchema.safeParse({ brandColors: ["#2f6bff"] });
    expect(ok.success && ok.data.brandColors).toEqual(["#2F6BFF"]);
    expect(lookSchema.safeParse({ brandColors: ["#111111", "#222222", "#333333", "#444444"] }).success).toBe(false);
    expect(lookSchema.safeParse({ brandColors: ["blue"] }).success).toBe(false);
  });
});

describe("knowledgeSchema", () => {
  it("treats blank fields as missing", () => {
    const r = knowledgeSchema.parse({ hours: "  ", area: "", contact: "Call us", faqs: [] });
    expect(r.hours).toBeUndefined();
    expect(r.contact).toBe("Call us");
  });
  it("reports which FAQ row is incomplete", () => {
    const r = knowledgeSchema.safeParse({ faqs: [{ question: "Open Sundays?", answer: "" }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(flatErrors(r.error)["faqs.0.answer"]).toBeTruthy();
  });
  it("prepareFaqs drops fully blank rows", () => {
    expect(prepareFaqs([{ question: " ", answer: "" }, { question: "Q", answer: "" }])).toHaveLength(1);
  });
  it("readKnowledge survives bad stored JSON", () => {
    expect(readKnowledge({ faqs: "nope" }).faqs).toEqual([]);
    expect(readKnowledge(null).faqs).toEqual([]);
  });
});

describe("isOwnLogoPath", () => {
  it("only accepts the user's own logo folder", () => {
    expect(isOwnLogoPath("u1", "u1/logo/abc-logo.png")).toBe(true);
    expect(isOwnLogoPath("u1", "u2/logo/abc-logo.png")).toBe(false);
    expect(isOwnLogoPath("u1", "u1/media/abc.png")).toBe(false);
    expect(isOwnLogoPath("u1", "u1/logo/../../u2/x.png")).toBe(false);
  });
});

describe("voice samples", () => {
  it("are non-empty for every voice and every industry", () => {
    for (const industry of [...industryOptions, null, ""]) {
      const topic = sampleTopic(industry);
      expect(topic.length).toBeGreaterThan(0);
      for (const v of voices) {
        const text = v.sample({ businessName: "Acme", topic });
        expect(text).toContain("Acme");
        expect(text.length).toBeGreaterThan(20);
      }
    }
    expect(industries.length).toBeGreaterThan(0);
  });
});

describe("validateKnowledge", () => {
  it("ignores blank rows and reports errors on the row the person sees", async () => {
    const { validateKnowledge } = await import("@/lib/brand/schemas");
    const r = validateKnowledge({ faqs: [{ question: "", answer: "" }, { question: "Delivery?", answer: "" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["faqs.1.answer"]);
  });
});
