import { describe, expect, it } from "vitest";
import { addMonths, usageWindowEnd, usageWindowStart } from "@/lib/billing/period";

const d = (s: string) => new Date(s);

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths(d("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths(d("2026-01-31T10:00:00Z"), 13).toISOString()).toBe("2027-02-28T10:00:00.000Z");
  });
});

describe("usage windows", () => {
  const anchor = d("2026-03-15T12:00:00Z");

  it("is the anchor during the first month", () => {
    expect(usageWindowStart(anchor, d("2026-04-01T00:00:00Z"))).toEqual(anchor);
    expect(usageWindowEnd(anchor, d("2026-04-01T00:00:00Z"))).toEqual(d("2026-04-15T12:00:00Z"));
  });

  it("moves forward each month inside a yearly period", () => {
    expect(usageWindowStart(anchor, d("2026-04-15T12:00:00Z"))).toEqual(d("2026-04-15T12:00:00Z"));
    expect(usageWindowStart(anchor, d("2026-04-15T11:59:59Z"))).toEqual(anchor);
    expect(usageWindowStart(anchor, d("2026-11-20T00:00:00Z"))).toEqual(d("2026-11-15T12:00:00Z"));
    expect(usageWindowEnd(anchor, d("2026-11-20T00:00:00Z"))).toEqual(d("2026-12-15T12:00:00Z"));
  });

  it("never starts before the anchor", () => {
    expect(usageWindowStart(anchor, d("2026-01-01T00:00:00Z"))).toEqual(anchor);
  });
});
