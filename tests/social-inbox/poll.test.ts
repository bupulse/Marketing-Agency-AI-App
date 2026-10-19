import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    connection: { findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    adminSetting: { findMany: vi.fn(), findUnique: vi.fn() },
    dueJob: { updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
  ingest: vi.fn(),
  scheduleJob: vi.fn(),
  isServiceEnabled: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/crypto", () => ({ decrypt: async (v: string) => v }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/inbox/ingest", () => ({ ingestInbound: mocks.ingest }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: mocks.isServiceEnabled }));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: mocks.scheduleJob, cancelJob: vi.fn(), registerJobHandler: vi.fn() }));

import { CallLimitError, pollAccount, type PollAccount } from "@/lib/social/inbox/composio-poll";
import { newCursor } from "@/lib/social/inbox/cursor";
import { runPoll } from "@/lib/social/inbox/poll";
import { clearInboxSettingsCache } from "@/lib/social/inbox/settings";
import type { InboundEvent } from "@/lib/inbox/types";

const KIGALI_NOON = new Date(Date.UTC(2026, 9, 20, 10, 0));
const SINCE = new Date(KIGALI_NOON.getTime() - 3600_000); // switched on an hour ago
const iso = (minutesAgo: number) => new Date(KIGALI_NOON.getTime() - minutesAgo * 60_000).toISOString().replace("Z", "+0000");

const ig: PollAccount = { businessId: "biz", connectionId: "c1", channel: "INSTAGRAM", network: "instagram", externalAccountId: "IG1", handle: "@shop" };

function igMedia(comments: { id: string; text: string; minutesAgo: number; from: string; username: string }[], count = comments.length) {
  return {
    data: [
      {
        id: "M1",
        caption: "New shoes in stock",
        timestamp: iso(30),
        comments_count: count,
        comments: { data: comments.map((c) => ({ id: c.id, text: c.text, timestamp: iso(c.minutesAgo), from: { id: c.from, username: c.username } })) },
      },
    ],
  };
}

/** A fake Composio: answers by tool slug and records every call. */
function fakeComposio(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const call = vi.fn(async (slug: string) => {
    calls.push(slug);
    if (!(slug in answers)) throw new Error(`unexpected ${slug}`);
    return answers[slug];
  });
  return { call, calls };
}

const stored = new Set<string>();
const ingest = vi.fn(async (event: InboundEvent) => {
  const key = event.externalMessageId!;
  const duplicate = stored.has(key);
  stored.add(key);
  return { duplicate };
});

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  clearInboxSettingsCache();
});

describe("pollAccount (BuPulse-Socials check)", () => {
  it("takes in new comments and DMs, skips the account's own and anything from before the switch-on", async () => {
    const { call, calls } = fakeComposio({
      INSTAGRAM_GET_IG_USER_MEDIA: igMedia([
        { id: "C1", text: "Price?", minutesAgo: 10, from: "U1", username: "ana" },
        { id: "C2", text: "Thanks all", minutesAgo: 9, from: "IG1", username: "shop" },
        { id: "C0", text: "old one", minutesAgo: 120, from: "U2", username: "bob" },
      ]),
      INSTAGRAM_LIST_ALL_CONVERSATIONS: {
        data: [
          {
            id: "T1",
            updated_time: iso(5),
            participants: { data: [{ id: "IG1", username: "shop" }, { id: "U3", username: "carla" }] },
            messages: { data: [{ id: "m1", created_time: iso(6), from: { id: "U3", username: "carla" }, message: "Do you deliver?" }, { id: "m2", created_time: iso(5), from: { id: "IG1", username: "shop" }, message: "Yes" }] },
          },
        ],
      },
    });
    const cursor = { ...newCursor(SINCE), dmAt: SINCE.toISOString() };
    const r = await pollAccount({ account: ig, cursor, call, ingest, now: KIGALI_NOON });
    expect(calls).toEqual(["INSTAGRAM_GET_IG_USER_MEDIA", "INSTAGRAM_LIST_ALL_CONVERSATIONS"]); // a quiet-cost check: 2 calls
    expect(r.found).toBe(2);
    const events = ingest.mock.calls.map(([e]) => e);
    expect(events[0]).toMatchObject({ kind: "COMMENT", channel: "INSTAGRAM", connectionId: "c1", externalMessageId: "C1", postExternalId: "M1", postCaption: "New shoes in stock", contact: { externalId: "U1", handle: "ana" } });
    expect(events[1]).toMatchObject({ kind: "MESSAGE", externalMessageId: "m1", text: "Do you deliver?", contact: { externalId: "U3", handle: "carla" } });
    expect(events[1].threadExternalId).toBeUndefined(); // keyed by account and person, like the webhooks
    expect(r.cursor.posts.M1.c).toBe(3);
    expect(r.cursor.activityAt).toBe(KIGALI_NOON.toISOString());
  });

  it("does not read a post again while its comment count is unchanged (dedupe across checks)", async () => {
    const media = { data: [{ id: "M1", timestamp: iso(30), comments_count: 2 }] };
    const comments = { data: [{ id: "C1", text: "hi", timestamp: iso(10), from: { id: "U1", username: "ana" } }, { id: "C2", text: "yo", timestamp: iso(8), from: { id: "U2", username: "bo" } }] };
    const first = fakeComposio({ INSTAGRAM_GET_IG_USER_MEDIA: media, INSTAGRAM_GET_IG_MEDIA_COMMENTS: comments, INSTAGRAM_LIST_ALL_CONVERSATIONS: { data: [] } });
    const r1 = await pollAccount({ account: ig, cursor: newCursor(SINCE), call: first.call, ingest, now: KIGALI_NOON });
    expect(first.calls).toContain("INSTAGRAM_GET_IG_MEDIA_COMMENTS");
    expect(r1.found).toBe(2);

    const second = fakeComposio({ INSTAGRAM_GET_IG_USER_MEDIA: media, INSTAGRAM_GET_IG_MEDIA_COMMENTS: comments, INSTAGRAM_LIST_ALL_CONVERSATIONS: { data: [] } });
    const r2 = await pollAccount({ account: ig, cursor: r1.cursor, call: second.call, ingest, now: new Date(KIGALI_NOON.getTime() + 300_000) });
    expect(second.calls).toEqual(["INSTAGRAM_GET_IG_USER_MEDIA", "INSTAGRAM_LIST_ALL_CONVERSATIONS"]);
    expect(r2.found).toBe(0);

    // A count that went up is read again; the comments already stored are duplicates, only the new one counts.
    const third = fakeComposio({
      INSTAGRAM_GET_IG_USER_MEDIA: { data: [{ id: "M1", timestamp: iso(30), comments_count: 3 }] },
      INSTAGRAM_GET_IG_MEDIA_COMMENTS: { data: [...comments.data, { id: "C3", text: "new", timestamp: iso(1), from: { id: "U3", username: "cy" } }] },
      INSTAGRAM_LIST_ALL_CONVERSATIONS: { data: [] },
    });
    const r3 = await pollAccount({ account: ig, cursor: r2.cursor, call: third.call, ingest, now: new Date(KIGALI_NOON.getTime() + 600_000) });
    expect(r3.found).toBe(1);
  });

  it("only opens conversations updated since the last check (Facebook: one call per changed conversation)", async () => {
    const fb: PollAccount = { ...ig, channel: "FACEBOOK", network: "facebook", externalAccountId: "P1", handle: null };
    const { call, calls } = fakeComposio({
      FACEBOOK_GET_PAGE_POSTS: { data: [] },
      FACEBOOK_GET_PAGE_CONVERSATIONS: { data: [{ id: "t_old", updated_time: iso(90) }, { id: "t_new", updated_time: iso(2) }] },
      FACEBOOK_GET_CONVERSATION_MESSAGES: { data: [{ id: "mid.1", created_time: iso(2), from: { id: "PSID1", name: "Dan" }, message: "Hello" }] },
    });
    const r = await pollAccount({ account: fb, cursor: { ...newCursor(SINCE), dmAt: iso(30) }, call, ingest, now: KIGALI_NOON });
    expect(calls.filter((c) => c === "FACEBOOK_GET_CONVERSATION_MESSAGES")).toHaveLength(1);
    expect(call).toHaveBeenCalledWith("FACEBOOK_GET_CONVERSATION_MESSAGES", expect.objectContaining({ conversation_id: "t_new", page_id: "P1" }));
    expect(ingest.mock.calls[0][0]).toMatchObject({ channel: "FACEBOOK", kind: "MESSAGE", contact: { externalId: "PSID1", name: "Dan" } });
    expect(new Date(r.cursor.dmAt!).getTime()).toBe(new Date(iso(2).replace("+0000", "Z")).getTime());
  });

  it("stops at the monthly limit and keeps unread posts for the next check", async () => {
    const call = vi.fn(async (slug: string) => {
      if (slug === "INSTAGRAM_GET_IG_USER_MEDIA") return { data: [{ id: "M1", timestamp: iso(30), comments_count: 4 }] };
      throw new CallLimitError("month");
    });
    const r = await pollAccount({ account: ig, cursor: newCursor(SINCE), call, ingest, now: KIGALI_NOON });
    expect(r.limited).toBe("month");
    expect(r.cursor.posts.M1).toBeUndefined(); // not read, so read next time
    expect(call).not.toHaveBeenCalledWith("INSTAGRAM_LIST_ALL_CONVERSATIONS", expect.anything());
    expect(r.cursor.lastError).toMatch(/limit/);
  });

  it("records a failing part and still reads the other", async () => {
    const call = vi.fn(async (slug: string) => {
      if (slug === "INSTAGRAM_GET_IG_USER_MEDIA") throw new Error("(#10) Application does not have permission");
      return { data: [] };
    });
    const r = await pollAccount({ account: ig, cursor: newCursor(SINCE), call, ingest, now: KIGALI_NOON });
    expect(r.errors[0]).toMatch(/^Comments: \(#10\)/);
    expect(call).toHaveBeenCalledWith("INSTAGRAM_LIST_ALL_CONVERSATIONS", expect.anything());
    expect(r.cursor.errors).toBe(1);
  });
});

describe("runPoll (the due job)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "c1",
    businessId: "biz",
    provider: "instagram",
    method: "COMPOSIO",
    status: "ACTIVE",
    inboxEnabled: true,
    inboxCursor: newCursor(SINCE),
    externalAccountId: "IG1",
    displayName: "@shop",
    accessTokenEncrypted: "ca_123",
    business: { timezone: "Africa/Kigali" },
    ...over,
  });

  beforeEach(() => {
    process.env.COMPOSIO_API_KEY = "test-key";
    mocks.isServiceEnabled.mockResolvedValue(true);
    mocks.prisma.adminSetting.findMany.mockResolvedValue([]);
    mocks.prisma.adminSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.connection.count.mockResolvedValue(1);
    mocks.prisma.$queryRaw.mockResolvedValue([{ used: 1 }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ successful: true, data: { data: [] } }), { status: 200 })),
    );
  });

  it("checks a switched-on account, reserving each call, and schedules the next check", async () => {
    mocks.prisma.connection.findUnique.mockResolvedValue(row());
    const r = await runPoll("c1", KIGALI_NOON);
    expect(r.outcome).toBe("checked");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(2); // one reservation per call
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled(); // reserved calls are not counted twice
    expect(r.next!.getTime() - KIGALI_NOON.getTime()).toBe(30 * 60_000);
  });

  it("does not call Composio at night in the business's time zone", async () => {
    mocks.prisma.connection.findUnique.mockResolvedValue(row());
    const night = new Date(Date.UTC(2026, 9, 20, 21, 0)); // 23:00 in Kigali
    const r = await runPoll("c1", night);
    expect(r.outcome).toBe("night");
    expect(fetch).not.toHaveBeenCalled();
    expect(r.next!.getTime() - night.getTime()).toBe(8 * 3600_000);
  });

  it("stops at the monthly limit without calling Composio", async () => {
    mocks.prisma.connection.findUnique.mockResolvedValue(row());
    mocks.prisma.adminSetting.findUnique.mockResolvedValue({ key: "composio.calls.2026-10", value: 17_499 });
    const r = await runPoll("c1", KIGALI_NOON);
    expect(r.outcome).toBe("limit");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops the chain when the account is switched off or the route is Meta direct", async () => {
    mocks.prisma.connection.findUnique.mockResolvedValue(row({ inboxEnabled: false }));
    expect((await runPoll("c1", KIGALI_NOON)).outcome).toBe("stopped");
    clearInboxSettingsCache();
    mocks.prisma.connection.findUnique.mockResolvedValue(row());
    mocks.prisma.adminSetting.findMany.mockResolvedValue([{ key: "inbox.meta.transport", value: "meta" }]);
    expect((await runPoll("c1", KIGALI_NOON)).outcome).toBe("stopped");
    expect(fetch).not.toHaveBeenCalled();
  });
});
