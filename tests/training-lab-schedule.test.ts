import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { trainingExample: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { buildProfile, EMPTY_PROFILE, NETWORK_DEFAULTS, preferredHours, preferredWeekdays, withLab, type PostResult } from "@/lib/autopilot/learning";
import { labHoursByNetwork, parseScheduleNotes } from "@/lib/training-lab/schedule";
import { labSchedule } from "@/lib/training-lab/schedule-reader";

beforeEach(() => {
  findMany.mockReset();
});

describe("parseScheduleNotes", () => {
  it("accepts the typed shape", () => {
    expect(parseScheduleNotes({ network: "facebook", country: " Rwanda ", hours: [7, 12, 19], weekdays: [1, 3], postsPerWeek: 5, formats: ["Reel", "photo"] })).toEqual({ network: "facebook", country: "Rwanda", hours: [7, 12, 19], weekdays: [1, 3], postsPerWeek: 5, formats: ["reel", "photo"] });
  });
  it("reads hours written loosely", () => {
    expect(parseScheduleNotes({ hours: "7, 12:30, 19h" })?.hours).toEqual([7, 12, 19]);
    expect(parseScheduleNotes({ hours: "7am and 7pm 12am" })?.hours).toEqual([7, 19, 0]);
    expect(parseScheduleNotes({ hours: "7; 7" })?.hours).toEqual([7]);
  });
  it("reads weekday names and a network written as X", () => {
    expect(parseScheduleNotes({ network: "X", weekdays: "Tue, Thursday, sat." })).toEqual({ network: "twitter", weekdays: [1, 3, 5] });
    expect(parseScheduleNotes({ weekdays: [0, 6] })?.network).toBeUndefined();
    expect(parseScheduleNotes({ network: "all", hours: [8] })).toEqual({ hours: [8] });
  });
  it("refuses nonsense", () => {
    expect(parseScheduleNotes(null)).toBeNull();
    expect(parseScheduleNotes("7, 12")).toBeNull();
    expect(parseScheduleNotes([7])).toBeNull();
    expect(parseScheduleNotes({})).toBeNull();
    expect(parseScheduleNotes({ network: "myspace", hours: [7] })).toBeNull();
    expect(parseScheduleNotes({ hours: [25] })).toBeNull();
    expect(parseScheduleNotes({ hours: "late at night" })).toBeNull();
    expect(parseScheduleNotes({ hours: "7, 99" })).toBeNull();
    expect(parseScheduleNotes({ weekdays: ["someday"], hours: [9] })).toEqual({ hours: [9] });
    expect(parseScheduleNotes({ postsPerWeek: 500 })).toBeNull();
    expect(parseScheduleNotes({ postsPerWeek: 2.5 })).toBeNull();
  });
});

describe("labHoursByNetwork", () => {
  const ex = (rating: number | null, notes: unknown, over: Record<string, unknown> = {}) => ({ id: `e${Math.random()}`, rating, notes, createdAt: new Date("2026-10-01"), ...over });
  it("merges examples, the higher rated first, without repeats", () => {
    const out = labHoursByNetwork([ex(3, { network: "facebook", hours: [18, 12] }), ex(5, { network: "facebook", hours: [7, 12] }), ex(4, { network: "instagram", weekdays: [2] })]);
    expect(out.hours.get("facebook")).toEqual([7, 12, 18]);
    expect(out.weekdays.get("instagram")).toEqual([2]);
    expect(out.hours.has("instagram")).toBe(false);
  });
  it("makes an example with no network count for every network, and leaves out 1 and 2 stars and bad notes", () => {
    const out = labHoursByNetwork([ex(null, { hours: [20] }), ex(1, { network: "tiktok", hours: [3] }), ex(5, "nonsense")]);
    expect(out.hours.get("tiktok")).toEqual([20]);
    expect(out.hours.get("linkedin")).toEqual([20]);
    expect(out.exampleIds).toHaveLength(1);
  });
  it("keeps the best rated example's posts per week, for the Team page", () => {
    const out = labHoursByNetwork([ex(3, { network: "facebook", postsPerWeek: 3 }), ex(5, { network: "facebook", postsPerWeek: 6 })]);
    expect(out.postsPerWeek.get("facebook")).toBe(6);
  });
  it("filters by country (names and codes are the same), keeps examples with none", () => {
    const list = [ex(4, { network: "facebook", hours: [7], country: "Kenya" }), ex(4, { network: "facebook", hours: [8], country: "RW" }), ex(4, { network: "facebook", hours: [9] })];
    expect(labHoursByNetwork(list, { country: "Rwanda" }).hours.get("facebook")).toEqual([8, 9]);
    expect(labHoursByNetwork(list).hours.get("facebook")).toHaveLength(3);
  });
  it("does not change its input", () => {
    const list = Object.freeze([ex(3, { hours: [1] }), ex(5, { hours: [2] })]);
    expect(() => labHoursByNetwork(list)).not.toThrow();
  });
});

describe("labSchedule", () => {
  it("reads schedule examples switched on for the schedule engine", async () => {
    findMany.mockResolvedValue([{ id: "a", rating: 5, notes: { network: "facebook", hours: [7] }, createdAt: new Date() }]);
    const out = await labSchedule({ country: "Rwanda" });
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { kind: "schedule", engines: { has: "schedule" } }, take: 100 });
    expect(out.hours.get("facebook")).toEqual([7]);
  });
  it("is empty on a database error", async () => {
    findMany.mockRejectedValue(new Error("down"));
    const out = await labSchedule();
    expect(out.hours.size + out.weekdays.size + out.postsPerWeek.size).toBe(0);
  });
});

describe("the planner's preferred times", () => {
  const post = (over: Partial<PostResult>): PostResult => ({ playbookId: "x", network: "instagram", publishedAt: new Date("2026-09-14T10:00:00Z"), reach: 1000, likes: 10, comments: 0, saves: 0, shares: 0, ...over });
  const lab = { hours: new Map([["facebook", [7, 13]]]), weekdays: new Map([["facebook", [6]]]) };
  it("is identical with an empty Lab", () => {
    const empty = { hours: new Map(), weekdays: new Map() };
    expect(withLab(EMPTY_PROFILE, empty)).toBe(EMPTY_PROFILE);
    expect(withLab(EMPTY_PROFILE, null)).toBe(EMPTY_PROFILE);
    const learned = buildProfile(Array.from({ length: 8 }, (_, i) => post({ publishedAt: new Date(`2026-09-${10 + i}T1${i % 3}:00:00Z`) })), "UTC");
    for (const n of Object.keys(NETWORK_DEFAULTS) as (keyof typeof NETWORK_DEFAULTS)[]) {
      expect(preferredHours(withLab(learned, empty), n)).toEqual(preferredHours(learned, n));
      expect(preferredWeekdays(withLab(learned, empty), n)).toEqual(preferredWeekdays(learned, n));
    }
  });
  it("puts the Lab's times after the learned ones and before the defaults", () => {
    const p = withLab(EMPTY_PROFILE, lab);
    expect(preferredHours(p, "facebook")).toEqual([7, 13, 18]);
    expect(preferredWeekdays(p, "facebook")).toEqual([6, 1, 2, 3, 5]);
    expect(preferredHours(p, "instagram")).toEqual(NETWORK_DEFAULTS.instagram.hours);
  });
  it("keeps learned hours first once there is enough data", () => {
    const learned = buildProfile(Array.from({ length: 8 }, () => post({ network: "facebook", publishedAt: new Date("2026-09-14T16:00:00Z") })), "UTC");
    expect(learned.confident).toBe(true);
    expect(preferredHours(withLab(learned, lab), "facebook").slice(0, 3)).toEqual([16, 7, 13]);
  });
  it("does not change the profile it is given", () => {
    withLab(EMPTY_PROFILE, lab);
    expect(EMPTY_PROFILE.labHours).toBeUndefined();
  });
});
