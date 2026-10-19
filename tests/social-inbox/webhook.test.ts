import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { adminSetting: { findMany: vi.fn() }, connection: { findMany: vi.fn() } },
  ingest: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/inbox/ingest", () => ({ ingestInbound: mocks.ingest }));
vi.mock("@/lib/entitlements", () => ({ hasFeature: async () => true }));

import { GET, POST } from "@/app/api/meta/webhook/route";
import { readWebhook, verifySignature } from "@/lib/social/inbox/meta-webhook";
import { clearInboxSettingsCache } from "@/lib/social/inbox/settings";

const URL_BASE = "https://bupulse.test/api/meta/webhook";
const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const post = (body: string, signature?: string) => new Request(URL_BASE, { method: "POST", body, headers: signature ? { "x-hub-signature-256": signature } : {} });

const IG_DELIVERY = {
  object: "instagram",
  entry: [
    {
      id: "IG1",
      time: 1_790_000_000,
      changes: [
        { field: "comments", value: { id: "C9", text: "How much?", from: { id: "U1", username: "ana" }, media: { id: "M1" } } },
        { field: "comments", value: { id: "C10", text: "Thanks!", from: { id: "IG1", username: "shop" }, media: { id: "M1" } } },
      ],
      messaging: [
        { sender: { id: "U2" }, recipient: { id: "IG1" }, timestamp: 1_790_000_000_000, message: { mid: "mid.A", text: "Hi", quick_reply: { payload: "PRICE" } } },
        { sender: { id: "IG1" }, recipient: { id: "U2" }, timestamp: 1_790_000_000_001, message: { mid: "mid.B", text: "echo", is_echo: true } },
        { sender: { id: "U3" }, recipient: { id: "IG1" }, timestamp: 1_790_000_000_002, message: { mid: "mid.C", attachments: [{ type: "story_mention", payload: { url: "https://x" } }] } },
        { sender: { id: "U4" }, recipient: { id: "IG1" }, timestamp: 1_790_000_000_003, postback: { mid: "mid.D", title: "Book now", payload: "BOOK" } },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  clearInboxSettingsCache();
  process.env.FACEBOOK_APP_SECRET = "fb-secret";
  process.env.INSTAGRAM_APP_SECRET = "ig-secret";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-me";
  mocks.prisma.adminSetting.findMany.mockResolvedValue([{ key: "inbox.meta.transport", value: "meta" }]);
  mocks.prisma.connection.findMany.mockResolvedValue([{ id: "c1", businessId: "biz" }]);
  mocks.ingest.mockResolvedValue({ duplicate: false });
});

describe("webhook subscription check (GET)", () => {
  it("echoes hub.challenge when the verify token matches", async () => {
    const r = await GET(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("12345");
  });

  it("refuses a wrong or missing token, or when no token is configured", async () => {
    expect((await GET(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`))).status).toBe(403);
    expect((await GET(new Request(`${URL_BASE}?hub.mode=subscribe&hub.challenge=1`))).status).toBe(403);
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    expect((await GET(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`))).status).toBe(403);
  });
});

describe("webhook deliveries (POST)", () => {
  it("verifies X-Hub-Signature-256 against either app secret", async () => {
    const body = JSON.stringify(IG_DELIVERY);
    expect(await verifySignature(body, sign(body, "ig-secret"), ["fb-secret", "ig-secret"])).toBe(true);
    expect(await verifySignature(body, sign(body, "attacker"), ["fb-secret", "ig-secret"])).toBe(false);
    expect(await verifySignature(body + " ", sign(body, "ig-secret"), ["ig-secret"])).toBe(false);
    expect(await verifySignature(body, "sha1=abc", ["ig-secret"])).toBe(false);
    expect(await verifySignature(body, null, ["ig-secret"])).toBe(false);
  });

  it("rejects a forged delivery without storing anything", async () => {
    const body = JSON.stringify(IG_DELIVERY);
    expect((await POST(post(body, sign(body, "attacker")))).status).toBe(401);
    expect((await POST(post(body))).status).toBe(401);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("stores comments, DMs, story mentions and button taps, skipping echoes and the account's own comments", async () => {
    const body = JSON.stringify(IG_DELIVERY);
    const r = await POST(post(body, sign(body, "ig-secret")));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, stored: 4 });
    const events = mocks.ingest.mock.calls.map(([e]) => e);
    expect(events.map((e) => [e.kind, e.externalMessageId])).toEqual([
      ["MESSAGE", "mid.A"],
      ["STORY_MENTION", "mid.C"],
      ["MESSAGE", "mid.D"],
      ["COMMENT", "C9"],
    ]);
    expect(events[0]).toMatchObject({ businessId: "biz", connectionId: "c1", channel: "INSTAGRAM", buttonId: "PRICE", contact: { externalId: "U2" } });
    expect(events[2]).toMatchObject({ text: "Book now", buttonId: "BOOK" });
    expect(events[3]).toMatchObject({ postExternalId: "M1", contact: { externalId: "U1", handle: "ana" } });
    expect(mocks.prisma.connection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ provider: "instagram", externalAccountId: "IG1", inboxEnabled: true, method: "DIRECT" }) }));
  });

  it("answers 200 and drops the delivery while the route is BuPulse-Socials", async () => {
    mocks.prisma.adminSetting.findMany.mockResolvedValue([]);
    const body = JSON.stringify(IG_DELIVERY);
    const r = await POST(post(body, sign(body, "ig-secret")));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ dropped: true });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});

describe("Facebook Page payloads", () => {
  it("reads new comments from the feed field and Messenger DMs", () => {
    const items = readWebhook({
      object: "page",
      entry: [
        {
          id: "P1",
          changes: [
            { field: "feed", value: { item: "comment", verb: "add", comment_id: "P1_1_2", post_id: "P1_1", message: "Open Sunday?", from: { id: "F1", name: "Eve" }, created_time: 1_790_000_000 } },
            { field: "feed", value: { item: "comment", verb: "edited", comment_id: "P1_1_3", post_id: "P1_1", message: "x", from: { id: "F2" } } },
            { field: "feed", value: { item: "reaction", verb: "add", from: { id: "F3" } } },
          ],
          messaging: [{ sender: { id: "PSID9" }, recipient: { id: "P1" }, timestamp: 1_790_000_000_000, message: { mid: "m_1", text: "Hello" } }],
        },
      ],
    });
    expect(items.map((i) => [i.network, i.accountId, i.event.kind, i.event.externalMessageId])).toEqual([
      ["facebook", "P1", "MESSAGE", "m_1"],
      ["facebook", "P1", "COMMENT", "P1_1_2"],
    ]);
    expect(items[1].event).toMatchObject({ channel: "FACEBOOK", postExternalId: "P1_1", contact: { externalId: "F1", name: "Eve" } });
  });

  it("ignores unknown objects", () => {
    expect(readWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(readWebhook(null)).toEqual([]);
  });
});
