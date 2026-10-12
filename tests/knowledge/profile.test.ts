import { describe, expect, it } from "vitest";
import { profileCompleteness, profileFormValues, profileInputSchema, profileJson, readProfile } from "@/lib/knowledge/profile";
import { KNOWLEDGE_SECTIONS, overallPercent, SECTION_KEYS } from "@/lib/knowledge/sections";
import { SECTION_ICONS } from "@/components/knowledge/section-icons";
import { fieldErrorMap } from "@/lib/knowledge/products";

const valid = { name: "Sunrise Bakery", about: "We bake bread every morning.", industry: "food", industryOther: "", industryDescription: "A family bakery in Kigali selling bread." };
const now = new Date("2026-10-12T00:00:00Z");

describe("company profile", () => {
  it("requires the name, what the company does and the sector (and its description)", () => {
    const r = profileInputSchema(now).safeParse({ name: "", about: "", industry: "", industryOther: "", industryDescription: "" });
    expect(Object.keys(fieldErrorMap(r.error!))).toEqual(expect.arrayContaining(["name", "about", "industry", "industryDescription"]));
    const other = profileInputSchema(now).safeParse({ ...valid, industry: "other", industryOther: "" });
    expect(fieldErrorMap(other.error!)).toEqual({ industryOther: "Tell us your industry." });
  });

  it("checks the optional fields and normalises them", () => {
    const parse = (patch: Record<string, unknown>) => profileInputSchema(now).safeParse({ ...valid, ...patch });
    expect(parse({ yearFounded: "2027" }).success).toBe(false);
    expect(parse({ yearFounded: "1799" }).success).toBe(false);
    expect(parse({ size: "huge" }).success).toBe(false);
    expect(parse({ registrationNumber: "<script>" }).success).toBe(false);
    expect(parse({ website: "not a site" }).success).toBe(false);
    const ok = parse({ yearFounded: "2015", size: "2-5", website: "sunrise.rw", registrationNumber: "TIN 123/456", values: [" Honesty", "honesty", ""], languages: ["Kinyarwanda", "English"] });
    expect(ok.data).toMatchObject({ yearFounded: 2015, size: "2-5", website: "https://sunrise.rw", values: ["Honesty"], tagline: null });
    expect(profileJson(ok.data!)).toEqual({ tagline: null, mission: null, vision: null, about: valid.about, yearFounded: 2015, size: "2-5", legalName: null, registrationNumber: "TIN 123/456", languages: ["Kinyarwanda", "English"], values: ["Honesty"], achievements: [] });
  });

  it("reads a stored profile field by field and fills the form, starting 'about' from the onboarding description", () => {
    expect(readProfile({ tagline: "Hi", yearFounded: "soon", values: "x" })).toMatchObject({ tagline: "Hi", yearFounded: null, values: [] });
    const values = profileFormValues({ name: "B", website: null, description: "We sell bread", profile: null, knowledgeArea: "Kigali" }, { industry: "food", industryOther: "", industryDescription: "d" });
    expect(values).toMatchObject({ about: "We sell bread", serviceArea: "Kigali", yearFounded: "", languages: [] });
  });

  it("weighs completeness so the required fields count most", () => {
    expect(profileCompleteness({ name: "B", website: null, hasSector: false, profile: null, serviceArea: null }).percent).toBe(15);
    const full = profileCompleteness({ name: "B", website: "https://b.rw", hasSector: true, profile: { about: "a", tagline: "t", mission: "m", vision: "v", yearFounded: 2015, size: "solo", languages: ["English"], values: ["x"] }, serviceArea: "Kigali" });
    expect(full).toEqual({ percent: 100, missing: [] });
  });
});

describe("knowledge base sections", () => {
  it("has every section once, an icon for each, and placeholders for part 2", () => {
    expect(KNOWLEDGE_SECTIONS.map((s) => s.key)).toEqual([...SECTION_KEYS]);
    for (const key of SECTION_KEYS) expect(SECTION_ICONS[key], key).toBeTruthy();
    expect(KNOWLEDGE_SECTIONS.filter((s) => s.status === "coming_soon").map((s) => s.key)).toEqual(["audience", "competitors", "faqs", "reviews", "interview"]);
    expect(KNOWLEDGE_SECTIONS.find((s) => s.key === "products")).toMatchObject({ href: "/dashboard/knowledge/products", feature: "content", permission: "content" });
  });

  it("averages the ready sections that report a percentage", () => {
    expect(overallPercent({ profile: { percent: 80, summary: "" }, products: { percent: 40, summary: "" }, campaigns: { percent: null, summary: "" } })).toBe(60);
    expect(overallPercent({})).toBe(0);
  });
});
