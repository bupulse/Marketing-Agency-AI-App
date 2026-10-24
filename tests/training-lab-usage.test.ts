import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { agentRun: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { ago, exampleUsage, usageFrom, usageLine, type UsageRow } from "@/lib/training-lab/usage";

const now = new Date("2026-10-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const run = (agentId: string, exampleIds: string[], h: number, rating: number | null = null): UsageRow => ({ agentId, exampleIds, rating, createdAt: hoursAgo(h) });

beforeEach(() => {
  findMany.mockReset();
});

describe("usageFrom", () => {
  const rows = [run("script-writer", ["a", "b"], 2, 5), run("designer", ["a"], 5, 4), run("script-writer", ["a", "a"], 30), run("checker", ["zzz"], 1)];
  it("counts runs per example, names the members most active first, and averages the ratings", () => {
    const out = usageFrom(rows, ["a", "b", "c"]);
    expect(out.get("a")).toEqual({ times: 3, agents: ["Script writer", "Designer"], last: hoursAgo(2), avgRating: 4.5 });
    expect(out.get("b")).toEqual({ times: 1, agents: ["Script writer"], last: hoursAgo(2), avgRating: 5 });
    expect(out.has("c")).toBe(false);
    expect(out.has("zzz")).toBe(false);
  });
  it("has no average when no run was rated, and keeps an unknown member's id", () => {
    const out = usageFrom([run("ghost", ["a"], 1)], ["a"]);
    expect(out.get("a")).toMatchObject({ agents: ["ghost"], avgRating: null });
  });
});

describe("exampleUsage", () => {
  it("makes one query for all the ids, for the last 30 days", async () => {
    findMany.mockResolvedValue([run("designer", ["a"], 1)]);
    const out = await exampleUsage(["a", "b"], now);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { exampleIds: { hasSome: ["a", "b"] }, createdAt: { gte: new Date("2026-09-24T12:00:00Z") } }, take: 3000 });
    expect(out.get("a")?.times).toBe(1);
  });
  it("asks nothing for no examples, and is empty on an error", async () => {
    expect((await exampleUsage([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    findMany.mockRejectedValue(new Error("down"));
    expect((await exampleUsage(["a"])).size).toBe(0);
  });
});

describe("the card's line", () => {
  it("says how often, by whom, when, and how their work was rated", () => {
    const use = { times: 7, agents: ["Script writer", "Designer"], last: hoursAgo(2), avgRating: 4.5 };
    expect(usageLine(use, now)).toBe("Used 7 times in the last 30 days, by Script writer and Designer (last: 2 hours ago; their work rated 4.5)");
  });
  it("handles once, one member, three members and no rating", () => {
    expect(usageLine({ times: 1, agents: ["Checker"], last: hoursAgo(0.001), avgRating: null }, now)).toBe("Used once in the last 30 days, by Checker (last: just now)");
    expect(usageLine({ times: 3, agents: ["A", "B", "C"], last: hoursAgo(50), avgRating: null }, now)).toBe("Used 3 times in the last 30 days, by A, B and C (last: 2 days ago)");
  });
  it("says so when it was not used", () => {
    expect(usageLine(undefined, now)).toBe("Not used yet in the last 30 days");
  });
  it("words the time", () => {
    expect(ago(new Date(now.getTime() - 90_000), now)).toBe("2 minutes ago");
    expect(ago(hoursAgo(1), now)).toBe("1 hour ago");
    expect(ago(hoursAgo(24), now)).toBe("1 day ago");
  });
});
