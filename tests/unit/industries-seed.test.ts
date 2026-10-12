import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { industries } from "@/lib/content/site";
import { INDUSTRY_OTHER, industryFormValues, industryKey } from "@/lib/industries/shared";

// The marketing /industries page keeps its static list; the migration seeds the same sectors as data, so a sign-up
// sector and a marketing card never disagree on names, and old Business.industry values link by name.
const sql = readFileSync(new URL("../../prisma/migrations/20261012120000_industries/migration.sql", import.meta.url), "utf8");

describe("industry seeds", () => {
  it("seed every marketing industry by slug and name, with the Rwandan calendar and an 'avoid' list", () => {
    for (const i of industries) {
      expect(sql, i.slug).toContain(`'${i.slug}', '${i.name.replace(/'/g, "''")}'`);
    }
    expect(sql.match(/^\(\n  'ind_/gm)).toHaveLength(industries.length);
    for (const word of ["Kwibuka", "Kwibohora", "Umuganura", "Umuganda", "RWF", "EBM", "back-to-school", "rainy season"]) expect(sql.toLowerCase()).toContain(word.toLowerCase());
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('REVOKE ALL ON TABLE "Industry", "DismissedIndustrySuggestion" FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain('ON DELETE SET NULL');
  });

  it("'other' is never a seeded slug and normalises like the suggestions", () => {
    expect(industries.some((i) => i.slug === INDUSTRY_OTHER)).toBe(false);
    expect(industryKey("  Car   WASH ")).toBe("car wash");
    expect(industryFormValues({ industryRef: { slug: "retail" }, industryOther: null, industryDescription: "d" })).toEqual({ industry: "retail", industryOther: "", industryDescription: "d" });
    expect(industryFormValues({ industryRef: null, industryOther: "Car wash", industryDescription: null })).toEqual({ industry: "other", industryOther: "Car wash", industryDescription: "" });
    expect(industryFormValues({})).toEqual({ industry: "", industryOther: "", industryDescription: "" });
  });
});
