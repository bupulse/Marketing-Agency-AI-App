import { describe, expect, it } from "vitest";
import { campaignFormValues, campaignInputSchema, campaignPhase, formatDateRange, isDay } from "@/lib/knowledge/campaigns";
import { fieldErrorMap } from "@/lib/knowledge/products";

const errors = (input: Record<string, unknown>) => {
  const r = campaignInputSchema.safeParse(input);
  return r.success ? {} : fieldErrorMap(r.error);
};

describe("campaign validation", () => {
  it("requires the type and name, a date for an event, and an end on or after the start", () => {
    expect(Object.keys(errors({}))).toEqual(expect.arrayContaining(["type", "name"]));
    expect(errors({ type: "EVENT", name: "Open day" })).toEqual({ startsOn: "Add the date of the event." });
    expect(errors({ type: "OFFER", name: "Sale", startsOn: "2026-10-10", endsOn: "2026-10-09" })).toEqual({ endsOn: "The end date must be on or after the start date." });
    expect(errors({ type: "OFFER", name: "Sale", startsOn: "2026-02-30" })).toEqual({ startsOn: "Pick a date." });
    expect(errors({ type: "OFFER", name: "Sale" })).toEqual({});
    // Every problem at once: the event date shows while the name is missing too.
    expect(Object.keys(errors({ type: "EVENT", name: "" }))).toEqual(expect.arrayContaining(["name", "startsOn"]));
  });

  it("cleans highlights and product ids, and caps them", () => {
    const ok = campaignInputSchema.parse({ type: "LAUNCH", name: "New branch", highlights: [" Free cake ", "free cake"], productIds: ["a", "a", "b"] });
    expect(ok).toMatchObject({ highlights: ["Free cake"], productIds: ["a", "b"], startsOn: null, endsOn: null, status: "ACTIVE" });
    expect(errors({ type: "LAUNCH", name: "x", productIds: Array.from({ length: 31 }, (_, i) => `p${i}`) })).toHaveProperty("productIds");
    expect(errors({ type: "LAUNCH", name: "x", status: "GONE" })).toHaveProperty("status");
  });

  it("knows where a campaign is in time", () => {
    expect(campaignPhase({ startsOn: "2026-10-20", endsOn: "2026-10-22" }, "2026-10-12")).toBe("upcoming");
    expect(campaignPhase({ startsOn: "2026-10-20", endsOn: "2026-10-22" }, "2026-10-22")).toBe("running");
    expect(campaignPhase({ startsOn: "2026-10-20", endsOn: null }, "2026-10-21")).toBe("ended"); // a one-day event
    expect(campaignPhase({ startsOn: null, endsOn: null }, "2026-10-21")).toBe("undated");
  });

  it("formats date ranges and round-trips stored dates", () => {
    expect(formatDateRange("2026-10-12", null)).toBe("12 Oct 2026");
    expect(formatDateRange("2026-10-12", "2026-10-14")).toBe("12–14 Oct 2026");
    expect(formatDateRange("2026-10-30", "2026-11-02")).toBe("30 Oct – 2 Nov 2026");
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 – 2 Jan 2027");
    expect(isDay("2026-13-01")).toBe(false);
    const values = campaignFormValues({ type: "EVENT", name: "Open day", description: null, startsAt: new Date("2026-10-24T00:00:00.000Z"), endsAt: null, priceInfo: null, highlights: [], status: "DRAFT", productIds: ["p1"] });
    expect(values).toMatchObject({ startsOn: "2026-10-24", endsOn: "", priceInfo: "", productIds: ["p1"], status: "DRAFT" });
  });
});
