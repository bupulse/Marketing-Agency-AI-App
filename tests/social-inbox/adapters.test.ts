import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    connection: { findUnique: vi.fn() },
    adminSetting: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
  isServiceEnabled: vi.fn(),
  loadCredentials: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/crypto", () => ({ decrypt: async (v: string) => v }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: mocks.isServiceEnabled }));
vi.mock("@/lib/social/connections", () => ({ loadCredentials: mocks.loadCredentials }));

import { channelAdapter } from "@/lib/inbox/channels";
import "@/lib/inbox/all-channels";
import { ChannelSendError, type SendTarget } from "@/lib/inbox/types";
import { clearInboxSettingsCache } from "@/lib/social/inbox/settings";
import { inboxScopesFor } from "@/lib/social/inbox/scopes";
import { routeFor } from "@/lib/social/inbox/transport";
import { instagramProvider } from "@/lib/social/providers/instagram";
import { facebookProvider } from "@/lib/social/providers/facebook";

const target = (over: Partial<SendTarget> = {}): SendTarget => ({
  businessId: "biz",
  conversationId: "conv1",
  channel: "INSTAGRAM",
  connectionId: "c1",
  threadExternalId: "dm:c1:U1",
  chatSessionId: null,
  recipientExternalId: "U1",
  ...over,
});
const account = (over: Record<string, unknown> = {}) => ({ id: "c1", businessId: "biz", provider: "instagram", method: "COMPOSIO", externalAccountId: "IG1", accessTokenEncrypted: "ca_1", inboxEnabled: true, ...over });
const settings = (rows: { key: string; value: unknown }[]) => mocks.prisma.adminSetting.findMany.mockResolvedValue(rows);

let fetchMock: ReturnType<typeof vi.fn>;
const composioAnswers = (data: unknown, successful = true, error: string | null = null) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ successful, data, error }), { status: 200 }));
const bodyOf = (i = 0) => JSON.parse(String(fetchMock.mock.calls[i][1].body));

beforeEach(() => {
  vi.clearAllMocks();
  clearInboxSettingsCache();
  process.env.COMPOSIO_API_KEY = "test-key";
  process.env.FACEBOOK_APP_SECRET = "fb-secret";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-me";
  mocks.isServiceEnabled.mockResolvedValue(true);
  mocks.prisma.connection.findUnique.mockResolvedValue(account());
  mocks.prisma.$queryRaw.mockResolvedValue([{ used: 10 }]);
  settings([]);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("Instagram and Facebook adapters", () => {
  it("are registered with Meta's 24-hour window; private replies stay off until confirmed", async () => {
    const ig = channelAdapter("INSTAGRAM")!;
    expect(channelAdapter("FACEBOOK")).toBeTruthy();
    expect(ig.capabilities.windowHours).toBe(24);
    expect(ig.capabilities.commentReply).toBe(true);
    expect(await ig.available()).toBe(true);
    expect(ig.capabilities.privateReply).toBe(false);
    clearInboxSettingsCache();
    settings([{ key: "inbox.privateReply.confirmed", value: true }]);
    await ig.available();
    expect(ig.capabilities.privateReply).toBe(true);
  });

  it("is unavailable when the route is not set up", async () => {
    mocks.isServiceEnabled.mockResolvedValue(false);
    expect(await channelAdapter("INSTAGRAM")!.available()).toBe(false);
    clearInboxSettingsCache();
    mocks.isServiceEnabled.mockResolvedValue(true);
    settings([{ key: "inbox.meta.transport", value: "meta" }]);
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    expect(await channelAdapter("INSTAGRAM")!.available()).toBe(false);
  });

  it("sends a DM through BuPulse-Socials, reserving the call first", async () => {
    composioAnswers({ message_id: "mid.out" });
    const r = await channelAdapter("INSTAGRAM")!.send(target(), { text: "Yes, we deliver", buttons: [{ id: "b", title: "Order", url: "https://shop.rw/o" }] });
    expect(r.externalId).toBe("mid.out");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/tools\/execute\/INSTAGRAM_SEND_TEXT_MESSAGE$/);
    expect(bodyOf()).toMatchObject({ connected_account_id: "ca_1", user_id: "biz", arguments: { recipient_id: "U1", ig_user_id: "IG1", text: "Yes, we deliver\n\nOrder: https://shop.rw/o" } });
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("explains the window (or missing access) when Meta refuses, and never shows an access token", async () => {
    composioAnswers(null, false, "(#10) This message is sent outside of allowed window. subcode 2534022");
    const error = await channelAdapter("INSTAGRAM")!.send(target(), { text: "Hello again" }).catch((e) => e);
    expect(error).toBeInstanceOf(ChannelSendError);
    expect(error).toMatchObject({ code: "window", retry: false });
    expect(error.message).toMatch(/more than 24 hours ago, or this connection is not yet allowed/);
    composioAnswers(null, false, "Bad request https://graph.instagram.com/v21.0/x/messages?access_token=IGAAsecret123&limit=25");
    const leaky = await channelAdapter("INSTAGRAM")!.send(target(), { text: "Hello again" }).catch((e) => e);
    expect(leaky.message).not.toContain("IGAAsecret123");
  });

  it("refuses a DM to someone who only commented", async () => {
    const error = await channelAdapter("INSTAGRAM")!.send(target({ threadExternalId: "comments:c1:U1" }), { text: "Hi" }).catch((e) => e);
    expect(error).toMatchObject({ code: "comment_thread", retry: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops replies at the monthly limit", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    const error = await channelAdapter("INSTAGRAM")!.send(target(), { text: "Hi" }).catch((e) => e);
    expect(error).toMatchObject({ code: "budget", retry: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a Facebook comment publicly and clips Instagram comment replies to 300 characters", async () => {
    mocks.prisma.connection.findUnique.mockResolvedValue(account({ provider: "facebook", externalAccountId: "P1" }));
    composioAnswers({ id: "P1_1_9" });
    await channelAdapter("FACEBOOK")!.replyToComment!(target({ channel: "FACEBOOK" }), "P1_1_2", "Yes, open Sunday");
    expect(bodyOf()).toMatchObject({ arguments: { object_id: "P1_1_2", message: "Yes, open Sunday" } });

    mocks.prisma.connection.findUnique.mockResolvedValue(account());
    await channelAdapter("INSTAGRAM")!.replyToComment!(target(), "C1", "word ".repeat(100));
    const sent = bodyOf(1).arguments.message as string;
    expect(sent.length).toBeLessThanOrEqual(300);
    expect(sent.endsWith("…")).toBe(true);
  });

  it("refuses private replies until an admin confirmed them, then sends them through Composio's proxy", async () => {
    const off = await channelAdapter("INSTAGRAM")!.privateReply!(target(), "C1", { text: "Here is the price list" }).catch((e) => e);
    expect(off).toMatchObject({ code: "private_reply_off" });
    expect(fetchMock).not.toHaveBeenCalled();

    clearInboxSettingsCache();
    settings([{ key: "inbox.privateReply.confirmed", value: true }]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 200, data: { recipient_id: "U1", message_id: "mid.pr" } }), { status: 200 }));
    const r = await channelAdapter("INSTAGRAM")!.privateReply!(target(), "C1", { text: "Here is the price list" });
    expect(r.externalId).toBe("mid.pr");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/tools\/execute\/proxy$/);
    expect(bodyOf()).toMatchObject({ endpoint: "/IG1/messages", method: "POST", body: { recipient: { comment_id: "C1" }, message: { text: "Here is the price list" } } });
  });

  it("maps a proxied Meta error to a plain message", async () => {
    clearInboxSettingsCache();
    settings([{ key: "inbox.privateReply.confirmed", value: true }]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 400, data: { error: { message: "Already replied privately to this comment", code: 10, error_subcode: 2018108 } } }), { status: 200 }));
    const error = await channelAdapter("INSTAGRAM")!.privateReply!(target(), "C1", { text: "x" }).catch((e) => e);
    expect(error).toMatchObject({ code: "private_reply_used", retry: false });
  });
});

describe("transport switch", () => {
  it("routes each account only through the way it was connected", () => {
    expect(routeFor("COMPOSIO", "composio").ok).toBe(true);
    expect(routeFor("DIRECT", "composio").ok).toBe(false);
    expect(routeFor("DIRECT", "meta").ok).toBe(true);
    expect(routeFor("COMPOSIO", "meta").ok).toBe(false);
  });

  it("sends through the Graph API with the account's own token on Meta direct", async () => {
    settings([{ key: "inbox.meta.transport", value: "meta" }]);
    mocks.prisma.connection.findUnique.mockResolvedValue(account({ method: "DIRECT", provider: "facebook", externalAccountId: "P1" }));
    mocks.loadCredentials.mockResolvedValue({ accessToken: "EAApage", externalAccountId: "P1" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ recipient_id: "PSID", message_id: "m_out" }), { status: 200 }));
    const r = await channelAdapter("FACEBOOK")!.send(target({ channel: "FACEBOOK", recipientExternalId: "PSID" }), { text: "Hello" });
    expect(r.externalId).toBe("m_out");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://graph.facebook.com/v23.0/P1/messages");
    const form = new URLSearchParams(String(init.body));
    expect(JSON.parse(form.get("recipient")!)).toEqual({ id: "PSID" });
    expect(JSON.parse(form.get("message")!)).toEqual({ text: "Hello" });
    expect(form.get("messaging_type")).toBe("RESPONSE");
    expect(init.headers.Authorization).toBe("Bearer EAApage");
  });

  it("tells the owner to reconnect an account connected the other way", async () => {
    settings([{ key: "inbox.meta.transport", value: "meta" }]);
    const error = await channelAdapter("INSTAGRAM")!.send(target(), { text: "Hi" }).catch((e) => e);
    expect(error).toMatchObject({ code: "other_method", retry: false });
  });

  it("asks direct sign-ins for the inbox permissions only on Meta direct", () => {
    expect(inboxScopesFor("instagram", "instagram", "composio")).toEqual([]);
    expect(inboxScopesFor("facebook", undefined, "composio")).toEqual([]);
    expect(inboxScopesFor("instagram", "instagram", "meta")).toEqual(["instagram_business_manage_messages", "instagram_business_manage_comments"]);
    expect(inboxScopesFor("instagram", "facebook", "meta")).toContain("pages_messaging");
    expect(inboxScopesFor("facebook", undefined, "meta")).toEqual(["pages_messaging", "pages_manage_metadata"]);
  });

  it("keeps today's sign-in URLs exactly as they are when no extra scopes are passed", () => {
    process.env.INSTAGRAM_APP_ID = "ig-app";
    process.env.INSTAGRAM_APP_SECRET = "ig-secret";
    process.env.FACEBOOK_APP_ID = "fb-app";
    const scopeOf = (url: string) => new URL(url).searchParams.get("scope");
    expect(scopeOf(instagramProvider.authorizeUrl({ state: "s", redirectUri: "https://x/cb" }))).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights");
    expect(scopeOf(facebookProvider.authorizeUrl({ state: "s", redirectUri: "https://x/cb" }))).toBe("pages_show_list,pages_read_engagement,pages_manage_posts");
    expect(scopeOf(facebookProvider.authorizeUrl({ state: "s", redirectUri: "https://x/cb", extraScopes: inboxScopesFor("facebook", undefined, "meta") }))).toBe(
      "pages_show_list,pages_read_engagement,pages_manage_posts,pages_messaging,pages_manage_metadata",
    );
  });
});
