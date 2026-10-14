import { beforeEach, describe, expect, it, vi } from "vitest";
import * as grant from "@/tests/stubs/entitlements";
// Plans are not part of this test's database: every plan feature is granted unless a test takes one away.
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const prisma = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
const logError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError }));

import { POST_RESULTS_FEATURE } from "@/lib/publishing/results";
import { resultsForPosts } from "@/lib/publishing/results-query";

const now = new Date("2026-10-14T09:00:00Z");
const auto = { postingMode: "AUTO", accountType: "business", status: "ACTIVE" };

function row(id: string, overrides: Record<string, unknown> = {}) {
  return { id, status: "PUBLISHED", network: "instagram", externalId: `x_${id}`, publishedAt: new Date("2026-10-13T09:00:00Z"), remindOnly: false, connection: auto, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  grant.missing.clear();
  prisma.$queryRaw.mockResolvedValue([]);
});

describe("resultsForPosts", () => {
  it("reads the newest snapshot of every published post in one query", async () => {
    const rows = [row("a"), row("b"), row("c"), row("d", { status: "SCHEDULED" })];
    prisma.$queryRaw.mockResolvedValue([{ postId: "a", capturedAt: new Date("2026-10-14T05:23:00Z"), views: 1200, reach: 900, likes: 48, comments: 6, shares: 2, saves: 1 }]);
    const results = await resultsForPosts("b1", rows, now);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [string[], ...unknown[]];
    expect(strings.join("?")).toMatch(/DISTINCT ON \(m\."postId"\)/);
    expect(values).toEqual([["a", "b", "c"], "b1"]);

    expect(results.get("a")).toMatchObject({ state: "ready", views: 1200, likes: 48, comments: 6, updatedAt: "2026-10-14T05:23:00.000Z" });
    expect(results.get("b")).toEqual({ state: "waiting" });
    expect(results.has("d")).toBe(false);
  });

  it("asks nothing when no post is published", async () => {
    expect((await resultsForPosts("b1", [row("a", { status: "SCHEDULED" })], now)).size).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("shows nothing when the plan does not include per-post results", async () => {
    grant.missing.add(POST_RESULTS_FEATURE);
    expect((await resultsForPosts("b1", [row("a")], now)).size).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("does not need Analytics", async () => {
    grant.missing.add("analytics");
    expect((await resultsForPosts("b1", [row("a")], now)).get("a")).toEqual({ state: "waiting" });
  });

  it("logs a failed read and leaves the posts without results instead of failing the page", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("connection reset"));
    expect((await resultsForPosts("b1", [row("a")], now)).size).toBe(0);
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "publishing.results", businessId: "b1" }));
  });
});
