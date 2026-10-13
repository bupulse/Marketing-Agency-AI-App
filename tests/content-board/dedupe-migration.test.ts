import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20261016120000_dedupe_studio_drafts/migration.sql", "utf8");

describe("the one-off duplicate-draft clean-up", () => {
  it("removes only untouched Studio drafts, keeping the oldest of each content, app and account", () => {
    expect(sql).toContain(`"source" = 'STUDIO'`);
    expect(sql).toContain(`"ownerEditedAt" IS NULL`);
    expect(sql).toContain(`"status" IN ('PENDING_APPROVAL', 'DRAFT')`);
    expect(sql).toMatch(/PARTITION BY "contentId", "network", COALESCE\("connectionId", ''\)\s+ORDER BY "createdAt", "id"/);
    expect(sql).toContain("d.n > 1");
    expect(sql).not.toMatch(/UPDATE|DROP|TRUNCATE/i);
  });
});
