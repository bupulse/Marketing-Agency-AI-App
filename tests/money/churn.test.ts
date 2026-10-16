import { describe, expect, it } from "vitest";
import { stoppedAt } from "@/lib/money/revenue-shared";

const last = new Date("2026-09-01T00:00:00Z");

describe("when a client stopped paying", () => {
  it("is never for a client who pays", () => {
    expect(stoppedAt({ paying: true, status: "ACTIVE", periodEnd: null, interval: "MONTH", lastPaymentAt: last })).toBeNull();
  });
  it("is the end of the paid period after a cancel or expiry", () => {
    const end = new Date("2026-10-01T00:00:00Z");
    expect(stoppedAt({ paying: false, status: "CANCELED", periodEnd: end, interval: "MONTH", lastPaymentAt: last })).toEqual(end);
    expect(stoppedAt({ paying: false, status: "EXPIRED", periodEnd: end, interval: "MONTH", lastPaymentAt: last })).toEqual(end);
  });
  it("is the last payment plus its period for a deleted account (no subscription)", () => {
    expect(stoppedAt({ paying: false, status: null, periodEnd: null, interval: null, lastPaymentAt: last })).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(stoppedAt({ paying: false, status: null, periodEnd: null, interval: "YEAR", lastPaymentAt: last })?.toISOString().slice(0, 10)).toBe("2027-09-01");
  });
});
