import { describe, expect, it } from "vitest";
import {
  aspectRatio,
  distinctLabels,
  campaignDayLabel,
  campaignStatusKey,
  clock,
  compactNumber,
  dateRangeLabel,
  durationLabel,
  extraHashtags,
  initialOf,
  isLandscape,
  postStatusKey,
  priceLabel,
  progressOf,
  ringDash,
  splitCaption,
  timeLabel,
  truncateCaption,
} from "@/components/media-cards/helpers";

describe("durationLabel", () => {
  it("formats minutes and seconds", () => {
    expect(durationLabel(22_000)).toBe("0:22");
    expect(durationLabel(65_400)).toBe("1:05");
    expect(durationLabel(3_729_000)).toBe("1:02:09");
  });
  it("is null without a length", () => {
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(0)).toBeNull();
    expect(durationLabel(-5)).toBeNull();
  });
  it("clock never goes below zero", () => {
    expect(clock(-3)).toBe("0:00");
    expect(clock(7.4)).toBe("0:07");
  });
});

describe("splitCaption", () => {
  it("finds hashtags, mentions and links and keeps the text whole", () => {
    const text = "Fresh greens at home! #Kigali #hydro by @leaf.rw see https://leaf.rw/shop.";
    const tokens = splitCaption(text);
    expect(tokens.map((t) => t.value).join("")).toBe(text);
    expect(tokens.filter((t) => t.type === "tag").map((t) => t.value)).toEqual(["#Kigali", "#hydro"]);
    expect(tokens.filter((t) => t.type === "mention").map((t) => t.value)).toEqual(["@leaf.rw"]);
    expect(tokens.filter((t) => t.type === "link")).toHaveLength(1);
  });
  it("handles accents and plain text", () => {
    expect(splitCaption("Café #Muraho")).toEqual([
      { type: "text", value: "Café " },
      { type: "tag", value: "#Muraho" },
    ]);
    expect(splitCaption("no tags")).toEqual([{ type: "text", value: "no tags" }]);
    expect(splitCaption("")).toEqual([]);
  });
});

describe("extraHashtags", () => {
  it("adds the # and drops the ones already in the text or repeated", () => {
    expect(extraHashtags("Hello #kigali", ["Kigali", "#Rwanda", "rwanda", "", "#"])).toEqual(["#Rwanda"]);
    expect(extraHashtags("Hi", null)).toEqual([]);
  });
});

describe("truncateCaption", () => {
  it("keeps a short caption whole", () => {
    expect(truncateCaption("Short and sweet.")).toEqual({ text: "Short and sweet.", more: false });
  });
  it("cuts a long caption at a word", () => {
    const long = "Order your LEAF Hydro Tower today and grow crisp greens at home, all year round, without soil, in a corner of your kitchen or balcony.";
    const r = truncateCaption(long, 60);
    expect(r.more).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(r.text)).toBe(true);
    expect(r.text.endsWith(" ")).toBe(false);
    expect(r.text).toBe("Order your LEAF Hydro Tower today and grow crisp greens at");
  });
  it("stops after two lines", () => {
    expect(truncateCaption("one\ntwo\nthree")).toEqual({ text: "one\ntwo", more: true });
  });
});

describe("timeLabel", () => {
  const now = new Date("2026-11-12T10:00:00Z"); // 12:00 in Kigali (UTC+2), a Thursday
  it("past times", () => {
    expect(timeLabel("2026-11-12T09:59:40Z", now)).toBe("Just now");
    expect(timeLabel("2026-11-12T09:55:00Z", now)).toBe("5m");
    expect(timeLabel("2026-11-12T07:00:00Z", now)).toBe("3h");
    expect(timeLabel("2026-11-11T12:00:00Z", now)).toBe("Yesterday");
    expect(timeLabel("2026-11-08T12:00:00Z", now)).toBe("4d");
    expect(timeLabel("2026-10-01T12:00:00Z", now)).toBe("1 Oct");
    expect(timeLabel("2025-10-01T12:00:00Z", now)).toBe("1 Oct 2025");
  });
  it("future times", () => {
    expect(timeLabel("2026-11-12T10:20:00Z", now)).toBe("In 20 min");
    expect(timeLabel("2026-11-12T15:30:00Z", now)).toBe("Today 17:30");
    expect(timeLabel("2026-11-13T10:30:00Z", now)).toBe("Tomorrow 12:30");
    expect(timeLabel("2026-11-15T10:30:00Z", now)).toBe("Sun 12:30");
    expect(timeLabel("2026-11-25T10:30:00Z", now)).toBe("25 Nov, 12:30");
  });
  it("uses the business's time zone for the day", () => {
    // 23:30 UTC on the 12th is already the 13th in Kigali.
    expect(timeLabel("2026-11-12T23:30:00Z", now, "Africa/Kigali")).toBe("Tomorrow 01:30");
    expect(timeLabel("2026-11-12T23:30:00Z", now, "UTC")).toBe("Today 23:30");
  });
});

describe("status keys", () => {
  it("maps Post statuses", () => {
    expect(postStatusKey("PENDING_APPROVAL")).toBe("pending");
    expect(postStatusKey("SCHEDULED")).toBe("scheduled");
    expect(postStatusKey("SCHEDULED", true)).toBe("reminder");
    expect(postStatusKey("PUBLISHED")).toBe("posted");
    expect(postStatusKey("FAILED")).toBe("failed");
    expect(postStatusKey("WHATEVER")).toBe("draft");
  });
  it("maps creator campaign statuses", () => {
    expect(campaignStatusKey("LIVE")).toBe("live");
    expect(campaignStatusKey("DRAFT")).toBe("draft");
  });
});

describe("ratios", () => {
  it("gives CSS aspect ratios", () => {
    expect(aspectRatio("16:9")).toBe("16 / 9");
    expect(aspectRatio("1.91:1")).toBe("1.91 / 1");
    expect(aspectRatio("bad")).toBe("9 / 16");
    expect(aspectRatio(null, "4:5")).toBe("4 / 5");
    expect(isLandscape("16:9")).toBe(true);
    expect(isLandscape("9:16")).toBe(false);
  });
});

describe("priceLabel", () => {
  it("formats the price models", () => {
    expect(priceLabel("FIXED", 250000, "RWF")).toBe("250,000 RWF");
    expect(priceLabel("FROM", 6000, "RWF")).toBe("From 6,000 RWF");
    expect(priceLabel("PER_MONTH", 1500, "USD")).toBe("15.00 USD / month");
    expect(priceLabel("ON_REQUEST", 100, "RWF")).toBe("Price on request");
    expect(priceLabel("FIXED", null, "RWF")).toBe("Price on request");
  });
});

describe("numbers and ranges", () => {
  it("compacts counts", () => {
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(1200)).toBe("1.2K");
    expect(compactNumber(1_500_000)).toBe("1.5M");
  });
  it("progress and ring", () => {
    expect(progressOf(50, 200)).toBe(0.25);
    expect(progressOf(500, 200)).toBe(1);
    expect(progressOf(5, null)).toBe(0);
    const r = ringDash(0.25, 10);
    expect(Number(r.dashoffset)).toBeCloseTo(2 * Math.PI * 10 * 0.75, 1);
  });
  it("date ranges", () => {
    expect(dateRangeLabel("2026-11-12", "2026-11-30")).toBe("12 – 30 Nov");
    expect(dateRangeLabel("2026-11-28", "2026-12-04")).toBe("28 Nov – 4 Dec");
    expect(dateRangeLabel("2026-12-28", "2027-01-04")).toBe("28 Dec 2026 – 4 Jan 2027");
  });
  it("campaign day", () => {
    expect(campaignDayLabel("2026-11-10", "2026-11-27", "2026-11-13")).toBe("Day 4 of 18");
    expect(campaignDayLabel("2026-11-14", "2026-11-27", "2026-11-13")).toBe("Starts tomorrow");
    expect(campaignDayLabel("2026-11-16", "2026-11-27", "2026-11-13")).toBe("Starts in 3 days");
    expect(campaignDayLabel("2026-11-01", "2026-11-10", "2026-11-13")).toBe("Ended");
  });
  it("initials", () => {
    expect(initialOf("LinkedIn · acme")).toBe("A");
    expect(initialOf("  ")).toBe("?");
  });
});

describe("distinctLabels", () => {
  it("tells apart two versions on the same app by format, then by number", () => {
    expect(distinctLabels([{ name: "Facebook", detail: "Post" }, { name: "Instagram", detail: "Post" }, { name: "Facebook", detail: "Carousel" }, { name: "Instagram", detail: "Post" }])).toEqual([
      "Facebook · Post",
      "Instagram · Post",
      "Facebook · Carousel",
      "Instagram · Post 2",
    ]);
    expect(distinctLabels([{ name: "LinkedIn", detail: "Post" }, { name: "TikTok" }])).toEqual(["LinkedIn", "TikTok"]);
  });
});
