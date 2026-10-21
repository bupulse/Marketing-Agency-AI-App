import { beforeEach, describe, expect, it, vi } from "vitest";

// resolvePost against a small in-memory database and a fake network adapter: the three checks, the plain reasons,
// the one-campaign rule and what waits for the next run.
const db = vi.hoisted(() => {
  const state = {
    post: null as Record<string, unknown> | null,
    connections: [] as Record<string, unknown>[],
    other: null as { campaignId: string } | null,
    updates: [] as Record<string, unknown>[],
    snapshots: [] as Record<string, unknown>[],
    connectionUpdates: [] as Record<string, unknown>[],
  };
  const prisma = {
    creatorPost: {
      findUnique: vi.fn(async () => state.post),
      findFirst: vi.fn(async () => state.other),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        return data;
      }),
    },
    creatorConnection: {
      findMany: vi.fn(async () => state.connections),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => state.connectionUpdates.push(data)),
    },
    creatorPostSnapshot: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => state.snapshots.push(data)) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { state, prisma };
});
vi.mock("@/lib/db", () => ({ prisma: db.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { resolvePost } from "@/lib/creators/tracking/resolve";
import { BudgetError } from "@/lib/creators/tracking/caller";
import { SocialError } from "@/lib/social/types";
import type { CreatorAdapter, NetworkPost } from "@/lib/creators/tracking/types";

const NOW = new Date("2026-10-20T15:00:00Z");
const found = (over: Partial<NetworkPost> = {}): NetworkPost => ({ externalId: "m1", permalink: null, postedAt: new Date("2026-10-20T09:00:00Z"), caption: "My look with @leafshop", views: 120, reach: 100, likes: 8, comments: 1, shares: 0, ...over });
const adapter = (find: CreatorAdapter["find"]): CreatorAdapter => ({ accounts: vi.fn(), read: vi.fn(), find: vi.fn(find) });
const deps = (a: CreatorAdapter) => ({ adapter: () => a, caller: () => ({ tool: vi.fn(), proxy: vi.fn() }), now: NOW });
const last = () => db.state.updates.at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(db.state, {
    post: {
      id: "p1",
      status: "CHECKING",
      network: "instagram",
      url: "https://www.instagram.com/reel/DAbC123xyz/",
      createdAt: new Date("2026-10-20T14:00:00Z"),
      campaignId: "camp1",
      submission: { day: new Date("2026-10-20T00:00:00Z"), caption: "Typed by the creator" },
      campaign: { mentions: ["@leafshop"], business: { timezone: "Africa/Kigali" } },
      campaignCreator: { profileId: "prof1" },
    },
    connections: [{ id: "conn1", network: "instagram", externalAccountId: "ig1", composioConnectedAccountId: "ca1", profileId: "prof1", status: "ACTIVE" }],
    other: null,
    updates: [],
    snapshots: [],
    connectionUpdates: [],
  });
});

describe("checking a handed-in link", () => {
  it("passes all three checks: TRACKING with the first reading", async () => {
    expect(await resolvePost("p1", deps(adapter(async () => found())))).toBe("tracking");
    expect(last()).toMatchObject({ status: "TRACKING", externalId: "m1", connectionId: "conn1", checks: { ownAccount: true, onTime: true, mention: true }, views: 120, impressions: 100, nextReadAt: new Date("2026-10-20T21:00:00Z") });
    expect(db.state.snapshots).toEqual([{ postId: "p1", capturedAt: NOW, views: 120, impressions: 100, likes: 8, comments: 1, shares: 0 }]);
  });

  it("own account: a link not found on the creator's account is INVALID", async () => {
    expect(await resolvePost("p1", deps(adapter(async () => null)))).toBe("invalid");
    expect(last()).toMatchObject({ status: "INVALID", checks: { ownAccount: false }, statusReason: expect.stringMatching(/could not find this post on the Instagram account/) });
  });

  it("on time: an old post is INVALID", async () => {
    expect(await resolvePost("p1", deps(adapter(async () => found({ postedAt: new Date("2026-10-10T09:00:00Z") }))))).toBe("invalid");
    expect(last()).toMatchObject({ status: "INVALID", checks: { ownAccount: true, onTime: false }, statusReason: expect.stringMatching(/task's day/) });
  });

  it("mention: a caption without the campaign's mention is INVALID", async () => {
    expect(await resolvePost("p1", deps(adapter(async () => found({ caption: "My look" }))))).toBe("invalid");
    expect(last()).toMatchObject({ status: "INVALID", checks: { mention: false }, statusReason: expect.stringContaining("@leafshop") });
  });

  it("checks the handed-in caption when the network gives none", async () => {
    (db.state.post as { submission: { caption: string } }).submission.caption = "Look @LeafShop";
    expect(await resolvePost("p1", deps(adapter(async () => found({ caption: null }))))).toBe("tracking");
  });

  it("a post already earning in another campaign is refused nicely", async () => {
    db.state.other = { campaignId: "camp2" };
    expect(await resolvePost("p1", deps(adapter(async () => found())))).toBe("invalid");
    expect(last().statusReason).toMatch(/already handed in for another campaign/);
  });

  it("a link that is not a post link is INVALID without asking the network", async () => {
    (db.state.post as Record<string, unknown>).url = "https://www.instagram.com/ana.rw/";
    const a = adapter(async () => found());
    expect(await resolvePost("p1", deps(a))).toBe("invalid");
    expect(a.find).not.toHaveBeenCalled();
  });

  it("waits (CHECKING) while the network is down or the account needs signing in again", async () => {
    expect(await resolvePost("p1", deps(adapter(async () => Promise.reject(new SocialError("busy", "temporary", "instagram")))))).toBe("waiting");
    expect(last()).toEqual({ statusReason: "Instagram did not answer" });
    expect(await resolvePost("p1", deps(adapter(async () => Promise.reject(new SocialError("(#190) expired", "auth", "instagram")))))).toBe("waiting");
    expect(db.state.connectionUpdates.at(-1)).toMatchObject({ status: "EXPIRED" });
  });

  it("gives up after 3 days of waiting", async () => {
    (db.state.post as Record<string, unknown>).createdAt = new Date("2026-10-16T14:00:00Z");
    expect(await resolvePost("p1", deps(adapter(async () => Promise.reject(new SocialError("busy", "temporary", "instagram")))))).toBe("invalid");
  });

  it("stops when the month's Composio calls are used up", async () => {
    expect(await resolvePost("p1", deps(adapter(async () => Promise.reject(new BudgetError()))))).toBe("budget");
    expect(db.state.updates).toEqual([]);
  });
});
