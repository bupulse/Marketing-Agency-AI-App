import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The B Mail agent API (docs/mail-crm/AGENT_API.md) through its real route handlers, against the TEST database, with
// Storage mocked and after() stubbed so nothing is delivered from the test. Every queued email is to a
// delivered+…@resend.dev test address and is marked failed at once, so a delivery run elsewhere cannot send it.
// Skipped unless asked:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/mail/agent.db.test.ts
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL);

vi.mock("@/lib/mail/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => new Uint8Array()),
  pathSafe: (n: string) => n.replace(/[^\w.-]+/g, "_"),
}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));

const tag = `ag${Date.now().toString(36)}`;
const BASE = "https://mail.bupulse.com/api/mail/agent/v1";
const enc = (s: string) => new TextEncoder().encode(s);

describe.skipIf(!enabled)("agent API", { timeout: 120_000 }, async () => {
  const { prisma } = await import("@/lib/db");
  const { createAgentKey, revokeAgentKey } = await import("@/lib/mail/agent");
  const { receiveMail } = await import("@/lib/mail/inbound");
  const me = await import("@/app/api/mail/agent/v1/me/route");
  const send = await import("@/app/api/mail/agent/v1/send/route");
  const messages = await import("@/app/api/mail/agent/v1/messages/route");
  const status = await import("@/app/api/mail/agent/v1/messages/[id]/route");
  const keyIds: string[] = [];

  let made: { key: string; row: { id: string } };
  const call = (path: string, init: RequestInit = {}) => new Request(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${made.key}`, "content-type": "application/json", ...(init.headers ?? {}) } });

  beforeAll(async () => {
    const r = await createAgentKey({ name: `${tag} Sellbird`, mailboxId: "mbx_sales", dailyLimit: 2, fromName: "Ana from BuPulse", signature: false, memberId: "mm_cyusa", createdBy: `${tag}@example.com` });
    if (!r.ok) throw new Error(r.error);
    made = r;
    keyIds.push(r.row.id);
  });
  const stopDelivery = (id: string) => prisma.mailMessage.updateMany({ where: { id, status: "queued" }, data: { status: "failed", error: "test: not delivered" } });

  afterAll(async () => {
    await prisma.mailThread.deleteMany({ where: { mailboxId: "mbx_sales", subject: { contains: tag } } });
    await prisma.mailAgentKey.deleteMany({ where: { id: { in: keyIds } } });
  });

  it("refuses a missing, wrong or non-agent key", async () => {
    expect((await me.GET(new Request(`${BASE}/me`))).status).toBe(401);
    expect((await me.GET(new Request(`${BASE}/me`, { headers: { authorization: "Bearer bpm_live_nope" } }))).status).toBe(401);
    expect((await me.GET(new Request(`${BASE}/me`, { headers: { authorization: "Bearer bp_live_nope" } }))).status).toBe(401);
  });

  it("knows its mailbox and today's sends", async () => {
    const r = await me.GET(call("/me"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.mailbox.address).toBe("sales@bupulse.com");
    expect(body.key.fromName).toBe("Ana from BuPulse");
    expect(body.sends.dailyLimit).toBe(2);
    expect(body.sends.left).toBeLessThanOrEqual(2);
  });

  let first: { id: string; threadId: string; messageId: string };

  it("queues a plain email from sales@ with no undo window and no signature", async () => {
    const r = await send.POST(call("/send", { method: "POST", body: JSON.stringify({ to: { name: "Test Prospect", address: `delivered+${tag}@resend.dev` }, subject: `${tag} quick question`, text: "Hi,\nOne short question." }) }));
    expect(r.status).toBe(202);
    first = await r.json();
    const row = await prisma.mailMessage.findUnique({ where: { id: first.id } });
    await stopDelivery(first.id);
    expect(row?.agentKeyId).toBe(made.row.id);
    expect(row?.mailboxId).toBe("mbx_sales");
    expect(row?.fromAddress).toBe("sales@bupulse.com");
    expect(row?.fromName).toBe("Ana from BuPulse");
    expect(row?.messageId).toBe(first.messageId);
    expect(row?.text).toBe("Hi,\nOne short question.");
    expect(row!.sendAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row?.authorEmail).toBe("cyusa@bupulse.com");
  });

  it("reports the status of its own message only", async () => {
    const r = await status.GET(call(`/messages/${first.id}`), { params: Promise.resolve({ id: first.id }) });
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("failed");
    const other = await prisma.mailMessage.findFirst({ where: { agentKeyId: null }, select: { id: true } });
    if (other) expect((await status.GET(call(`/messages/${other.id}`), { params: Promise.resolve({ id: other.id }) })).status).toBe(404);
  });

  let cursor: string;

  it("lists the reply that arrived, then nothing new after its cursor", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const raw = [
      `From: Test Prospect <delivered+${tag}@resend.dev>`,
      "To: sales@bupulse.com",
      `Subject: Re: ${tag} quick question`,
      `Message-ID: <r1@${tag}.example>`,
      `In-Reply-To: <${first.messageId}>`,
      `References: <${first.messageId}>`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Sure, tell me more.",
    ].join("\r\n");
    expect((await receiveMail({ raw: enc(raw), recipient: "sales@bupulse.com" })).status).toBe("stored");
    const r = await messages.GET(call(`/messages?since=${encodeURIComponent(since)}`));
    expect(r.status).toBe(200);
    const page = await r.json();
    const reply = page.data.find((m: { messageId: string }) => m.messageId === `r1@${tag}.example`);
    expect(reply).toBeTruthy();
    expect(reply.inReplyTo).toBe(first.messageId);
    expect(reply.threadId).toBe(first.threadId);
    expect(reply.from.address).toBe(`delivered+${tag}@resend.dev`);
    expect(reply.text).toContain("Sure, tell me more.");
    expect(page.data.every((m: { from: { address: string } }) => m.from.address !== "sales@bupulse.com")).toBe(true);
    cursor = page.nextCursor;
    const next = await (await messages.GET(call(`/messages?cursor=${cursor}`))).json();
    expect(next.data).toEqual([]);
    expect(next.nextCursor).toBe(cursor);
    expect((await messages.GET(call("/messages?cursor=bad!"))).status).toBe(400);
  });

  it("threads its answer under the reply, then stops at the key's daily limit", async () => {
    const r = await send.POST(call("/send", { method: "POST", body: JSON.stringify({ to: `delivered+${tag}@resend.dev`, subject: `Re: ${tag} quick question`, text: "Great, here it is.", inReplyTo: `<r1@${tag}.example>` }) }));
    expect(r.status).toBe(202);
    const answer = await r.json();
    await stopDelivery(answer.id);
    expect(answer.threadId).toBe(first.threadId);
    const row = await prisma.mailMessage.findUnique({ where: { id: answer.id }, select: { inReplyTo: true, references: true } });
    expect(row?.inReplyTo).toBe(`r1@${tag}.example`);
    expect(row?.references).toContain(first.messageId);
    // Failed sends no longer count, so mark both as sent for the limit check, then put them back.
    await prisma.mailMessage.updateMany({ where: { id: { in: [first.id, answer.id] } }, data: { status: "sent" } });
    const third = await send.POST(call("/send", { method: "POST", body: JSON.stringify({ to: `delivered+${tag}@resend.dev`, subject: `${tag} third`, text: "t" }) }));
    await prisma.mailMessage.updateMany({ where: { id: { in: [first.id, answer.id] } }, data: { status: "failed" } });
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe("daily_limit");
  });

  it("refuses bad input, and stops working once revoked", async () => {
    expect((await send.POST(call("/send", { method: "POST", body: "not json" }))).status).toBe(400);
    expect((await send.POST(call("/send", { method: "POST", body: JSON.stringify({ to: "a@example.com, b@example.com", subject: "s", text: "t" }) }))).status).toBe(400);
    expect(await revokeAgentKey(made.row.id)).toBe(true);
    expect((await me.GET(call("/me"))).status).toBe(401);
  });
});
