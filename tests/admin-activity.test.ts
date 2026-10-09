import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const { slice, cursorOf, parseCursor, compareItems } = await import("@/lib/admin/activity");
import type { ActivityItem } from "@/lib/admin/activity-shared";

const item = (id: string, at: string): ActivityItem => ({ id, at, group: "signup", title: id, detail: null, tone: "neutral", userId: null, who: null, href: null });
// Several share one millisecond, which is when naive timestamp paging skips or repeats rows.
const all = [
  item("event:a", "2026-10-09T10:00:05.000Z"),
  item("audit:b", "2026-10-09T10:00:04.000Z"),
  item("error:c", "2026-10-09T10:00:04.000Z"),
  item("event:d", "2026-10-09T10:00:04.000Z"),
  item("billing:e", "2026-10-09T10:00:02.000Z"),
  item("event:f", "2026-10-09T10:00:01.000Z"),
];

describe("poll delay", () => {
  it("is 5 s while events arrive, 15 s after 2 quiet minutes, and back to 5 s on the next event", async () => {
    const { pollDelay } = await import("@/lib/admin/activity-shared");
    const t0 = 1_000_000;
    expect(pollDelay(t0, t0 + 10_000)).toBe(5000);
    expect(pollDelay(t0, t0 + 120_000)).toBe(5000);
    expect(pollDelay(t0, t0 + 121_000)).toBe(15_000);
    expect(pollDelay(t0 + 130_000, t0 + 131_000)).toBe(5000);
  });
});

describe("activity cursor paging", () => {
  it("orders newest first, ties by id", () => {
    expect(slice(all, { limit: 10 }).items.map((i) => i.id)).toEqual(["event:a", "error:c", "event:d", "audit:b", "billing:e", "event:f"].sort((x, y) => compareItems(all.find((i) => i.id === x)!, all.find((i) => i.id === y)!)));
  });

  it("pages through every row exactly once, even across tied times", () => {
    const seen: string[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page = slice(all, { before, limit: 2 });
      seen.push(...page.items.map((i) => i.id));
      if (!page.nextBefore) break;
      before = page.nextBefore;
    }
    expect(seen).toHaveLength(all.length);
    expect(new Set(seen).size).toBe(all.length);
  });

  it("polls: returns only what is newer than the cursor", () => {
    const first = slice(all, { limit: 3 });
    const grown = [item("event:z", "2026-10-09T10:00:09.000Z"), item("event:y", "2026-10-09T10:00:06.000Z"), ...all];
    const poll = slice(grown, { after: first.newest, limit: 50 });
    expect(poll.items.map((i) => i.id)).toEqual(["event:z", "event:y"]);
    expect(poll.newest).toBe(cursorOf(poll.items[0]));
    expect(poll.nextBefore).toBeNull();
    expect(slice(all, { after: first.newest, limit: 50 }).items).toEqual([]);
  });

  it("rejects a malformed cursor instead of throwing", () => {
    expect(parseCursor("nonsense")).toBeNull();
    expect(parseCursor("123~event:a")).toEqual({ ms: 123, id: "event:a" });
    expect(slice(all, { before: "garbage", limit: 2 }).items).toHaveLength(2);
  });

  it("a burst bigger than one batch is read oldest first with nothing lost", () => {
    const base = Date.parse("2026-10-09T11:00:00.000Z");
    const burst = Array.from({ length: 7 }, (_, i) => item(`event:b${i}`, new Date(base + i * 1000).toISOString()));
    const grown = [...burst, ...all];
    let cursor: string | null = slice(all, { limit: 3 }).newest;
    const got: string[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const p = slice(grown, { after: cursor, limit: 3 });
      got.push(...p.items.map((i) => i.id));
      cursor = p.newest;
      if (!p.more) break;
    }
    expect(new Set(got)).toEqual(new Set(burst.map((i) => i.id)));
    expect(got).toHaveLength(7);
    // and the next poll has nothing new
    expect(slice(grown, { after: cursor, limit: 3 }).items).toEqual([]);
  });

  it("the first batch of a burst is the oldest items, shown newest first", () => {
    const base = Date.parse("2026-10-09T11:00:00.000Z");
    const burst = Array.from({ length: 5 }, (_, i) => item(`event:c${i}`, new Date(base + i * 1000).toISOString()));
    const p = slice([...burst, ...all], { after: slice(all, { limit: 1 }).newest, limit: 2 });
    expect(p.items.map((i) => i.id)).toEqual(["event:c1", "event:c0"]);
    expect(p.more).toBe(true);
    expect(p.newest).toBe(cursorOf(p.items[0]));
  });

  it("an empty feed still gets a cursor, so polling carries on", () => {
    const now = Date.parse("2026-10-09T12:00:00.000Z");
    const p = slice([], { limit: 10, now });
    expect(p.items).toEqual([]);
    expect(p.newest).toBe(`${now - 10_000}~`);
    expect(parseCursor(p.newest)).toEqual({ ms: now - 10_000, id: "" });
    // an event that arrives afterwards is found from that cursor
    expect(slice([item("event:new", new Date(now - 2000).toISOString())], { after: p.newest, limit: 10 }).items).toHaveLength(1);
    // a poll that finds nothing keeps the cursor it was given
    expect(slice([], { after: "123~event:a", limit: 10 }).newest).toBe("123~event:a");
  });
});

