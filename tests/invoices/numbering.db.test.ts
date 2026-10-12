import { afterAll, describe, expect, it } from "vitest";

// The invoice number sequence against the real database, so it is skipped unless asked for (needs the migrations):
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/invoices/numbering.db.test.ts
// 40 concurrent nextval calls over the pool must give 40 distinct numbers. It only reads the sequence (each call uses
// one number, leaving a gap in the invoice numbers of that database: run it on a test database).
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL);

describe.skipIf(!enabled)("Invoice_number_seq against Postgres", { timeout: 60_000 }, () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("concurrent callers never share a number", async () => {
    const { nextInvoiceNumber } = await import("@/lib/invoices/service");
    const numbers = await Promise.all(Array.from({ length: 40 }, () => nextInvoiceNumber()));
    expect(new Set(numbers).size).toBe(40);
    for (const n of numbers) expect(n).toMatch(/^BP-INV-\d{4,}$/);
  });
});
