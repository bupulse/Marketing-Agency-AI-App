import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { WORKING_STATUSES } from "@/lib/image-engine/engine";

/** The statuses the database allows for a picture: the last migration that sets ImageConcept_status_check wins. */
function allowedStatuses(): string[] {
  const dir = path.join(process.cwd(), "prisma/migrations");
  let allowed: string[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) {
    const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    const found = [...sql.matchAll(/"ImageConcept_status_check"\s+CHECK\s*\("status" IN \(([^)]*)\)\)/g)].at(-1);
    if (found) allowed = [...found[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }
  return allowed;
}

describe("the picture steps and the database", () => {
  it("allows every step the engine saves (Postgres refuses any other status)", () => {
    // The first split into steps was held back because the check still allowed only planned, painting, done, failed.
    expect([...allowedStatuses()].sort()).toEqual([...WORKING_STATUSES, "done", "failed"].sort());
  });
});
