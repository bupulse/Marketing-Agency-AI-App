import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { DEFAULT_SUPPORT_SETTINGS, greetingFor, teamHours } from "@/lib/support/settings";

// Kigali is UTC+2 all year. 23 Oct 2026 is a Friday; the default team hours are Monday to Saturday, 08:00-20:00.
const at = (iso: string) => new Date(iso);

describe("team hours", () => {
  it("is open during the day and says until when", () => {
    expect(teamHours(DEFAULT_SUPPORT_SETTINGS, at("2026-10-23T08:00:00Z"))).toEqual({ open: true, opensAt: null, closesAt: "20:00", timezone: "Africa/Kigali", label: "team open until 20:00" });
  });

  it("before opening says it opens later today", () => {
    const h = teamHours(DEFAULT_SUPPORT_SETTINGS, at("2026-10-23T04:00:00Z")); // 06:00 in Kigali
    expect(h.open).toBe(false);
    expect(h.opensAt).toBe("08:00");
    expect(h.label).toBe("team opens at 08:00");
  });

  it("closes at the end of the range, not a minute later", () => {
    expect(teamHours(DEFAULT_SUPPORT_SETTINGS, at("2026-10-23T17:59:00Z")).open).toBe(true); // 19:59
    expect(teamHours(DEFAULT_SUPPORT_SETTINGS, at("2026-10-23T18:00:00Z")).open).toBe(false); // 20:00
  });

  it("after closing on a weekday says tomorrow", () => {
    expect(teamHours(DEFAULT_SUPPORT_SETTINGS, at("2026-10-23T19:00:00Z")).label).toBe("team opens tomorrow at 08:00");
  });

  it("names the weekday when the next opening is further away (Saturday night to Monday)", () => {
    expect(teamHours(DEFAULT_SUPPORT_SETTINGS, at("2026-10-24T19:00:00Z")).label).toBe("team opens Monday at 08:00");
    // Sunday itself is closed all day: Monday is "tomorrow".
    expect(teamHours(DEFAULT_SUPPORT_SETTINGS, at("2026-10-25T10:00:00Z")).label).toBe("team opens tomorrow at 08:00");
  });

  it("uses the Kigali day, not the UTC day", () => {
    // 22:30 UTC on Saturday is 00:30 on Sunday in Kigali: closed, and Monday is tomorrow.
    expect(teamHours(DEFAULT_SUPPORT_SETTINGS, at("2026-10-24T22:30:00Z")).label).toBe("team opens tomorrow at 08:00");
  });

  it("handles a lunch break with two ranges", () => {
    const hours = { "5": [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] };
    const lunch = teamHours({ hours }, at("2026-10-23T11:00:00Z")); // 13:00
    expect(lunch).toMatchObject({ open: false, opensAt: "14:00", label: "team opens at 14:00" });
    expect(teamHours({ hours }, at("2026-10-23T12:30:00Z"))).toMatchObject({ open: true, closesAt: "18:00" });
  });

  it("never open: the team replies by email", () => {
    expect(teamHours({ hours: {} }, at("2026-10-23T08:00:00Z"))).toEqual({ open: false, opensAt: null, closesAt: null, timezone: "Africa/Kigali", label: "the team replies by email" });
  });
});

describe("greeting per page", () => {
  const settings = {
    greetings: [
      { path: "/pricing", text: "Plans?", delaySec: 30, quickReplies: [] },
      { path: "/pricing/business", text: "Business plan?", delaySec: 20, quickReplies: [] },
      { path: "*", text: "Hi!", delaySec: 15, quickReplies: [] },
    ],
  };

  it("matches the exact page and its sub-pages", () => {
    expect(greetingFor(settings, "/pricing")?.text).toBe("Plans?");
    expect(greetingFor(settings, "/pricing/x")?.text).toBe("Plans?");
  });

  it("prefers the longest matching prefix", () => {
    expect(greetingFor(settings, "/pricing/business")?.text).toBe("Business plan?");
    expect(greetingFor(settings, "/pricing/business/yearly")?.text).toBe("Business plan?");
  });

  it("does not match a page that only starts with the same letters", () => {
    expect(greetingFor(settings, "/pricingx")?.text).toBe("Hi!");
  });

  it("falls back to * and to nothing", () => {
    expect(greetingFor(settings, "/")?.text).toBe("Hi!");
    expect(greetingFor({ greetings: [{ path: "/pricing", text: "Plans?", delaySec: 30, quickReplies: [] }] }, "/about")).toBeNull();
  });

  it("the default settings have a greeting for every page", () => {
    expect(greetingFor(DEFAULT_SUPPORT_SETTINGS, "/signup")?.delaySec).toBe(30);
    expect(greetingFor(DEFAULT_SUPPORT_SETTINGS, "/dashboard/connections")?.delaySec).toBe(15);
    expect(greetingFor(DEFAULT_SUPPORT_SETTINGS, "/anything")?.text).toMatch(/Questions about BuPulse/);
  });
});
