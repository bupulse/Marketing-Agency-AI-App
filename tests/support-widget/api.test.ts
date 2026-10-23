import { describe, expect, it, vi } from "vitest";
import { createHttpClient, SupportApiError } from "@/lib/support/client/api";
import { createMockClient } from "@/lib/support/client/mock";
import { renderBioPage } from "@/lib/bio/page";
import { buildBioView, type BioSettings, type BioSource } from "@/lib/bio/view";

type Call = { url: string; init: RequestInit };

function fakeFetch(answers: ((c: Call) => Response)[]) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(url), init: init ?? {} };
    calls.push(c);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected ${c.url}`);
    return next(c);
  });
  return { f: f as unknown as typeof fetch, calls };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const VISIT = { visitToken: "tok-1", me: { name: null, email: null, signedIn: false, businessName: null, needsForm: true }, hours: {}, greeting: null, conversation: null, realtime: { url: "https://x.supabase.co", anonKey: "pk" } };
const visitBody = { visitorKey: "k".repeat(32), surface: "public" as const, path: "/" };

describe("the API client", () => {
  it("sends the visit token on every call after /visit", async () => {
    const { f, calls } = fakeFetch([json(200, VISIT), json(200, { me: { ...VISIT.me, needsForm: false } })]);
    const c = createHttpClient({ fetch: f });
    await c.visit(visitBody);
    await c.prechat({ name: "A", email: "a@example.com", business: "B" });
    expect(calls[0].url).toBe("/api/support/v1/visit");
    expect((calls[0].init.headers as Record<string, string>)["X-Support-Visit"]).toBeUndefined();
    expect(calls[1].url).toBe("/api/support/v1/prechat");
    expect((calls[1].init.headers as Record<string, string>)["X-Support-Visit"]).toBe("tok-1");
  });

  it("turns { error } answers and lost connections into SupportApiError", async () => {
    const { f } = fakeFetch([json(200, VISIT), json(403, { error: { code: "challenge_required", message: "Check" } }), () => {
      throw new TypeError("offline");
    }]);
    const c = createHttpClient({ fetch: f });
    await c.visit(visitBody);
    await expect(c.start({ text: "hi", clientMsgId: "client-msg-1" })).rejects.toMatchObject({ status: 403, code: "challenge_required" });
    const lost = await c.start({ text: "hi", clientMsgId: "client-msg-1" }).catch((e) => e);
    expect(lost).toBeInstanceOf(SupportApiError);
    expect(lost.status).toBe(0);
  });

  it("opens the visit again once when the token expired", async () => {
    const { f, calls } = fakeFetch([json(200, VISIT), json(401, { error: { code: "visit_expired", message: "" } }), json(200, { ...VISIT, visitToken: "tok-2" }), json(200, { messages: [], status: "AI", aiActive: true, agent: null })]);
    const c = createHttpClient({ fetch: f });
    await c.visit(visitBody);
    await c.messages("c1", "m9");
    expect(calls.map((x) => x.url)).toEqual(["/api/support/v1/visit", "/api/support/v1/conversations/c1/messages?after=m9", "/api/support/v1/visit", "/api/support/v1/conversations/c1/messages?after=m9"]);
    expect((calls[3].init.headers as Record<string, string>)["X-Support-Visit"]).toBe("tok-2");
  });

  it("uploads in three steps: ask, PUT the file, done", async () => {
    const { f, calls } = fakeFetch([json(200, VISIT), json(200, { attachmentId: "a1", uploadUrl: "https://x.supabase.co/storage/v1/object/upload/sign/support/a1?token=t", token: "t" }), () => new Response("{}", { status: 200 }), json(200, { attachmentId: "a1" })]);
    const c = createHttpClient({ fetch: f });
    await c.visit(visitBody);
    const r = await c.upload("c1", new Blob(["x".repeat(10)], { type: "image/jpeg" }), { mime: "image/jpeg", fileName: "a.jpg" });
    expect(r).toEqual({ attachmentId: "a1" });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ mime: "image/jpeg", bytes: 10, fileName: "a.jpg" });
    expect(calls[2].init.method).toBe("PUT");
    expect((calls[2].init.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect(calls[3].url).toBe("/api/support/v1/conversations/c1/uploads/a1/done");
  });

  it("sends heartbeats straight to Supabase's RPC with the public key only", async () => {
    const { f, calls } = fakeFetch([json(200, VISIT), json(200, { unread: 2 })]);
    const c = createHttpClient({ fetch: f });
    expect(await c.heartbeat("/")).toBeNull(); // no visit yet: nothing sent
    await c.visit(visitBody);
    expect(await c.heartbeat("/pricing", "Pricing")).toEqual({ unread: 2 });
    expect(calls[1].url).toBe("https://x.supabase.co/rest/v1/rpc/support_heartbeat");
    const h = calls[1].init.headers as Record<string, string>;
    expect(h.apikey).toBe("pk");
    expect(h.Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ p_token: "tok-1", p_path: "/pricing", p_title: "Pricing" });
  });
});

describe("the mock server (development only)", () => {
  it("is idempotent on clientMsgId and hands over to a person", async () => {
    const later: (() => void)[] = [];
    const m = createMockClient({ delay: (fn) => void later.push(fn) });
    const v = await m.visit({ ...visitBody, surface: "dashboard" });
    expect(v.me.needsForm).toBe(false);
    const { conversation } = await m.start({ text: "How much does it cost?", clientMsgId: "same-1234" });
    await m.send(conversation.id, { text: "How much does it cost?", clientMsgId: "same-1234" });
    later.splice(0).forEach((fn) => fn());
    const after = await m.messages(conversation.id);
    expect(after.messages.filter((x) => x.author === "VISITOR")).toHaveLength(1);
    expect(after.messages.find((x) => x.author === "AI")?.sources?.[0].title).toBe("Billing, plans and usage");
    await m.human(conversation.id);
    later.splice(0).forEach((fn) => fn());
    const handed = await m.messages(conversation.id);
    expect(handed.aiActive).toBe(false);
    expect(handed.agent?.name).toBe("Jean M.");
    expect(handed.messages.some((x) => x.kind === "EVENT" && x.body.includes("the AI stepped back"))).toBe(true);
  });

  it("gives bio pages no greeting", async () => {
    const m = createMockClient();
    expect((await m.visit({ ...visitBody, surface: "bio" })).greeting).toBeNull();
  });
});

describe("the bio page's corner link", () => {
  it("opens the help chat in sales mode", () => {
    const source: BioSource = { name: "Sample Shop", defaultTagline: "", accent: "#2f6bff", logoUrl: null, whatsappNumbers: [], phoneNumbers: [], locations: [], hours: null, links: [], products: [] };
    const settings: BioSettings = { enabled: true, slug: "sample-shop", tagline: "", whatsapp: null, message: "", phone: null, location: null, landmark: "", showHours: false, links: [], productIds: [] };
    const view = buildBioView(source, settings);
    const html = renderBioPage({ view, mode: "live", siteUrl: "https://bupulse.com" });
    expect(html).toContain('class="made" href="https://bupulse.com/help-chat?from=bio&amp;utm_source=bio&amp;utm_medium=referral"');
    expect(html).toContain("Made with BuPulse</a>");
  });
});
