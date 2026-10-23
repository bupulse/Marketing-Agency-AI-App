import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/support/prechat", () => ({ SUPPORT_LEAD_KIND: "support_chat" }));

import { median, percent, secondsWithinHours, summarize } from "@/lib/support/stats";
import { DEFAULT_SUPPORT_SETTINGS } from "@/lib/support/settings";

// Default team hours: Monday to Saturday, 08:00-20:00 Kigali (UTC+2). 23 Oct 2026 is a Friday.
const hours = DEFAULT_SUPPORT_SETTINGS.hours;
const t = (iso: string) => new Date(iso);

describe("seconds inside team hours", () => {
  it("counts a wait fully inside the hours", () => {
    expect(secondsWithinHours(t("2026-10-23T08:00:00Z"), t("2026-10-23T08:05:00Z"), hours)).toBe(300);
  });
  it("counts nothing outside the hours", () => {
    expect(secondsWithinHours(t("2026-10-23T19:00:00Z"), t("2026-10-23T20:00:00Z"), hours)).toBe(0);
  });
  it("a chat handed over at 23:00 and answered at 08:05 waited 5 minutes", () => {
    expect(secondsWithinHours(t("2026-10-23T21:00:00Z"), t("2026-10-24T06:05:00Z"), hours)).toBe(300);
  });
  it("skips the closed Sunday", () => {
    // Saturday 19:55 to Monday 08:05 Kigali: 5 minutes on Saturday and 5 on Monday.
    expect(secondsWithinHours(t("2026-10-24T17:55:00Z"), t("2026-10-26T06:05:00Z"), hours)).toBe(600);
  });
  it("counts a whole working day as 12 hours", () => {
    expect(secondsWithinHours(t("2026-10-22T22:00:00Z"), t("2026-10-23T22:00:00Z"), hours)).toBe(12 * 3600);
  });
  it("is zero when the end is not after the start", () => {
    expect(secondsWithinHours(t("2026-10-23T09:00:00Z"), t("2026-10-23T09:00:00Z"), hours)).toBe(0);
    expect(secondsWithinHours(t("2026-10-23T09:00:00Z"), t("2026-10-23T08:00:00Z"), hours)).toBe(0);
  });
  it("adds up several ranges in a day", () => {
    const split = { "5": [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] };
    expect(secondsWithinHours(t("2026-10-23T09:00:00Z"), t("2026-10-23T13:00:00Z"), split)).toBe(2 * 3600); // 11:00-15:00 Kigali
  });
});

describe("median and percent", () => {
  it("median of odd, even and empty lists", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3); // (2 + 3) / 2 = 2.5, rounded
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBeNull();
  });
  it("percent rounds and has no value without a whole", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBeNull();
  });
});

describe("stats summary", () => {
  const chat = (v: Partial<{ aiReplyCount: number; aiResolved: boolean | null; handoverAt: Date | null; rating: number | null; assigneeId: string | null }> = {}) => ({ aiReplyCount: 1, aiResolved: null, handoverAt: null, rating: null, assigneeId: null, ...v });

  it("AI-solved counts only judged chats the AI answered", () => {
    const s = summarize(
      [chat({ aiResolved: true }), chat({ aiResolved: false }), chat({ aiResolved: true }), chat({ aiResolved: null }), chat({ aiReplyCount: 0, aiResolved: true })],
      [],
    );
    expect(s.chats).toBe(5);
    expect(s.aiSolvedPercent).toBe(67);
  });
  it("hand-over rate is over all chats; ratings over rated chats", () => {
    const s = summarize([chat({ handoverAt: new Date() }), chat(), chat({ rating: 1 }), chat({ rating: -1 }), chat({ rating: 1 })], [60, 120, 600]);
    expect(s.handoverPercent).toBe(20);
    expect(s.ratedGoodPercent).toBe(67);
    expect(s.firstHumanReplySec).toBe(120);
  });
  it("has empty numbers for an empty period", () => {
    expect(summarize([], [])).toEqual({ chats: 0, aiSolvedPercent: null, handoverPercent: null, firstHumanReplySec: null, ratedGoodPercent: null });
  });
});
