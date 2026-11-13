import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/components/publishing/helpers";

// A post planned for next year read "Planned for Mon, Mar 1, 2:00 PM", as if it were this March (QA 14 Nov).
describe("formatDateTime", () => {
  const now = new Date("2026-11-14T10:00:00Z");

  it("leaves the year out within this year", () => {
    expect(formatDateTime("2026-11-20T07:00:00Z", "Africa/Kigali", now)).toBe("Fri, Nov 20, 9:00 AM");
  });

  it("adds the year for another year, in the business's time zone", () => {
    expect(formatDateTime("2027-03-01T12:00:00Z", "Africa/Kigali", now)).toBe("Mon, Mar 1, 2027, 2:00 PM");
    // 31 Dec 23:30 UTC is already 1 Jan 2027 in Kigali.
    expect(formatDateTime("2026-12-31T23:30:00Z", "Africa/Kigali", now)).toBe("Fri, Jan 1, 2027, 1:30 AM");
  });
});
