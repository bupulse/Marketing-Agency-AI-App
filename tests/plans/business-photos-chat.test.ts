import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADDONS } from "@/lib/offers/shared";

// Business includes AI photos and the website chat since 14 October 2026 (docs/PLANS.md). The plan rows live in the
// database, so this reads the migration that changes them: it adds both features to BUSINESS only, gives at least the
// website chat add-on's 500 replies (a chat limit of 0 means the chat never answers, lib/usage.ts) and adds the card line.

const SQL = readFileSync("prisma/migrations/20261019150000_business_photos_chat/migration.sql", "utf8");

describe("migration 20261019150000_business_photos_chat", () => {
  it("adds AI photos and the website chat to the Business plan only", () => {
    expect(SQL).toContain(`'["aiPhotos", "websiteChat"]'::jsonb`);
    expect(SQL).toMatch(/WHERE "key" = 'BUSINESS'/);
    expect(SQL).not.toMatch(/'STARTER'|'PRO'|'STANDARD'/);
  });

  it("gives Business the website chat add-on's replies, never fewer", () => {
    const chat = ADDONS.find((a) => a.key === "websiteChat");
    const included = chat && chat.kind === "feature" ? chat.includes?.amount : undefined;
    expect(included).toBe(500);
    expect(SQL).toContain(`< ${included} THEN jsonb_set(p."limits", '{chat}', '${included}'::jsonb)`);
  });

  it("adds the chat line to the plan card once and audits the change", () => {
    expect(SQL.match(/Website chat that answers visitors and saves leads: 500 replies a month/g)).toHaveLength(2);
    expect(SQL).toContain(`LIKE '%Website chat%'`);
    expect(SQL).toContain(`'migration:20261019150000_business_photos_chat'`);
  });
});
