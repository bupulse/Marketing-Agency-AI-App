import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { calledToken, calledUrl, verifyCalledToken } from "@/lib/lead-alerts/called-link";

afterEach(() => { delete process.env.LEAD_LINK_SECRET; delete process.env.CRON_SECRET; });

describe("the Called link", () => {
  it("is signed per request and only its own token works", () => {
    process.env.CRON_SECRET = "s1";
    const t = calledToken("cq_a")!;
    expect(verifyCalledToken("cq_a", t)).toBe(true);
    expect(verifyCalledToken("cq_b", t)).toBe(false);
    expect(verifyCalledToken("cq_a", "x")).toBe(false);
    expect(verifyCalledToken("cq_a", null)).toBe(false);
    expect(calledUrl("https://bupulse.com/", "cq_a")).toBe(`https://bupulse.com/called/cq_a?t=${t}`);
  });

  it("is not offered without a server secret", () => {
    expect(calledUrl("https://bupulse.com", "cq_a")).toBeNull();
    expect(verifyCalledToken("cq_a", "anything")).toBe(false);
  });
});
