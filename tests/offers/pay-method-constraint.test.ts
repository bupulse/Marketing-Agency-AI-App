import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFER_PAY_METHODS } from "@/lib/offers/shared";

// The database refuses a PlanOffer.payMethod its check constraint does not list (Postgres 23514). The in-memory test
// database does not know constraints, so this reads the migrations: the latest definition of
// PlanOffer_pay_method_check must allow every way an offer can be paid (card was missing on 14 October 2026).

const DIR = "prisma/migrations";

function latestPayMethodCheck(): string[] {
  let list: string[] | null = null;
  for (const dir of readdirSync(DIR).filter((d) => /^\d{14}_/.test(d)).sort()) {
    const sql = readFileSync(join(DIR, dir, "migration.sql"), "utf8");
    for (const m of sql.matchAll(/"PlanOffer_pay_method_check"\s+CHECK\s*\([^;]*?IN\s*\(([^)]*)\)/g)) list = [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]);
  }
  if (!list) throw new Error("PlanOffer_pay_method_check not found in the migrations");
  return list;
}

describe("PlanOffer.payMethod in the database", () => {
  it("the latest check constraint allows every pay method the code writes", () => {
    expect([...latestPayMethodCheck()].sort()).toEqual([...OFFER_PAY_METHODS].sort());
  });
});
