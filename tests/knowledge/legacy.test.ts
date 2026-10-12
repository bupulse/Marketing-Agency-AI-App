import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyTypeOf, mapLegacyProject, PRODUCT_TYPES, type LegacyProject } from "@/lib/knowledge/legacy";

// The migration copies projects in SQL (prisma/migrations/20261013100000_knowledge_base); mapLegacyProject() is the
// same rule as a function. These tests pin the rule and check the SQL says the same thing.
const SQL = readFileSync(join(__dirname, "..", "..", "prisma", "migrations", "20261013100000_knowledge_base", "migration.sql"), "utf8");

const project = (patch: Partial<LegacyProject>): LegacyProject => ({ id: "p1", type: "product", title: "Sisal basket", price: "15,000 RWF", features: ["Hand-woven"], details: { notes: "Made in Huye.\nLarge size." }, photoPaths: ["u1/projects/a.jpg"], ...patch });

describe("mapLegacyProject", () => {
  it("turns product, listing, service and project into products of the right kind, keeping the id", () => {
    expect(mapLegacyProject(project({ type: "product" }))).toMatchObject({ target: "product", id: "p1", kind: "PHYSICAL", category: null });
    expect(mapLegacyProject(project({ type: "listing" }))).toMatchObject({ target: "product", kind: "PHYSICAL", category: "Listing" });
    expect(mapLegacyProject(project({ type: "Service " }))).toMatchObject({ target: "product", kind: "SERVICE", category: null });
    expect(mapLegacyProject(project({ type: "project" }))).toMatchObject({ target: "product", kind: "SERVICE", category: "Finished work" });
  });

  it("turns event and offer into campaigns, and anything else into an 'other' campaign", () => {
    expect(mapLegacyProject(project({ type: "event" }))).toMatchObject({ target: "campaign", id: "p1", type: "EVENT", priceInfo: "15,000 RWF", highlights: ["Hand-woven"] });
    expect(mapLegacyProject(project({ type: "offer" }))).toMatchObject({ target: "campaign", type: "OFFER" });
    for (const type of ["other", "milestone", "anything"]) expect(mapLegacyProject(project({ type }))).toMatchObject({ target: "campaign", type: "OTHER" });
  });

  it("keeps the text: notes become the description and the summary, the price text the note, photos the album", () => {
    expect(mapLegacyProject(project({}))).toEqual({
      target: "product",
      id: "p1",
      kind: "PHYSICAL",
      name: "Sisal basket",
      category: null,
      summary: "Made in Huye. Large size.",
      description: "Made in Huye.\nLarge size.",
      priceModel: "FIXED",
      priceAmount: null,
      priceNote: "15,000 RWF",
      usps: [],
      features: ["Hand-woven"],
      photoPaths: ["u1/projects/a.jpg"],
    });
    expect(mapLegacyProject(project({ details: null, price: "  " }))).toMatchObject({ summary: "Sisal basket", description: null, priceModel: "ON_REQUEST", priceNote: null });
    expect(mapLegacyProject(project({ price: "From $49" }))).toMatchObject({ priceModel: "FROM" });
    expect((mapLegacyProject(project({ details: { notes: "x".repeat(400) } })) as { summary: string }).summary).toHaveLength(300);
  });

  it("speaks the old type back for the playbook and the design templates", () => {
    for (const type of ["product", "listing", "service", "project"]) {
      const mapped = mapLegacyProject(project({ type }));
      expect(mapped.target === "product" && legacyTypeOf(mapped)).toBe(type);
    }
    expect(legacyTypeOf({ type: "EVENT" })).toBe("event");
    expect(legacyTypeOf({ type: "PROMOTION" })).toBe("offer");
    expect(legacyTypeOf({ type: "OTHER" })).toBe("other");
  });
});

describe("the migration SQL follows the same rule", () => {
  it("sends the same old types to products, and everything else to campaigns", () => {
    const list = `IN (${Object.keys(PRODUCT_TYPES).map((t) => `'${t}'`).join(", ")})`;
    expect(SQL).toContain(`WHERE lower(btrim(p."type")) ${list}`);
    expect(SQL).toContain(`WHERE lower(btrim(p."type")) NOT ${list}`);
    expect(SQL).toContain(`WHEN lower(btrim(p."type")) IN ('service', 'project') THEN 'SERVICE' ELSE 'PHYSICAL'`);
    expect(SQL).toContain(`WHEN 'listing' THEN 'Listing' WHEN 'project' THEN 'Finished work'`);
    expect(SQL).toContain(`WHEN 'event' THEN 'EVENT' WHEN 'offer' THEN 'OFFER' ELSE 'OTHER'`);
  });

  it("reads the price model with the same patterns as legacyPriceModel()", () => {
    expect(SQL).toContain(`WHEN coalesce(p."price", '') !~ '[0-9]' THEN 'ON_REQUEST'`);
    expect(SQL).toContain(`WHEN p."price" ~* '^\\s*from\\s' THEN 'FROM'`);
    expect(SQL).toContain(`WHEN p."price" ~* '(per|/|a|an)\\s*month|monthly' THEN 'PER_MONTH'`);
    expect(SQL).toContain(`WHEN p."price" ~* '(per|/|a|an)\\s*year|yearly|annual' THEN 'PER_YEAR'`);
  });

  it("keeps ids, moves photos into albums, points content, designs, posts and store links at the copies, and is safe to run again", () => {
    expect(SQL).toMatch(/INSERT INTO "Product" \("id",[\s\S]*?SELECT\s+p\."id"/);
    expect(SQL).toMatch(/INSERT INTO "Campaign" \("id",[\s\S]*?SELECT\s+p\."id"/);
    expect(SQL.match(/NOT EXISTS \(SELECT 1 FROM "(Product|Campaign)" x WHERE x\."id" = p\."id"\)/g)?.length).toBe(4);
    expect(SQL).toContain(`ON CONFLICT ("path") DO NOTHING`);
    for (const table of ["ProductPhoto", "CampaignPhoto"]) expect(SQL).toMatch(new RegExp(`INSERT INTO "${table}"[\\s\\S]*?ON CONFLICT DO NOTHING`));
    for (const table of ["GeneratedContent", "Design", "Post"]) {
      expect(SQL).toContain(`UPDATE "${table}"`);
      expect(SQL).toContain(`CREATE TRIGGER "${table}_legacy_subject" BEFORE INSERT ON "${table}"`);
    }
    expect(SQL).toContain(`UPDATE "ProductSync" s SET "productId" = s."projectId"`);
    expect(SQL).toContain(`ALTER TABLE "GeneratedContent" ALTER COLUMN "businessId" SET NOT NULL`);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.bupulse_legacy_subject\(\) FROM PUBLIC, anon, authenticated, service_role;/);
    // Nothing is dropped: older builds keep reading projects.
    expect(SQL).not.toMatch(/DROP (TABLE|COLUMN)/);
  });
});
