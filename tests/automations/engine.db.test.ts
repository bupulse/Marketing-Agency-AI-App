import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The automations engine against the real (TEST) database: contacts, conversations, runs and due jobs. Skipped unless asked:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/automations/engine.db.test.ts
// It creates a throwaway company and removes it afterwards. Nothing leaves the machine: the Instagram channel is a fake
// that records what it would send, the AI is mocked, and alert emails are captured.
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const admin = enabled ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const sent = vi.hoisted(() => ({ dms: [] as { to: string | null; text: string }[], publicReplies: [] as { commentId: string; text: string }[], privateReplies: [] as { commentId: string; text: string }[] }));
vi.mock("@/lib/entitlements", async (orig) => ({ ...(await orig<typeof import("@/lib/entitlements")>()), hasFeature: async () => true }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: async () => true }));
vi.mock("@/lib/push/service", async (orig) => ({ ...(await orig<typeof import("@/lib/push/service")>()), pushToLeadWatchers: async () => 0 }));
vi.mock("@/lib/leads/notify", () => ({ notifyNewLead: async () => ({ emailed: false, webhook: false, pushed: 0, whatsapp: false }) }));
vi.mock("@/lib/webhooks/emit", () => ({ emitWebhookEvent: async () => 0, queueWebhookEvent: async () => {} }));

const tag = randomUUID().slice(0, 8);
// The fake Instagram channel's capabilities; the last test switches private replies off.
const caps = { buttons: false, quickReplies: false, images: false, commentReply: true, privateReply: true, windowHours: 24 };

describe.skipIf(!enabled)("automations engine against the database", { timeout: 120_000 }, () => {
  let prisma: typeof import("@/lib/db").prisma;
  let ingest: typeof import("@/lib/inbox/ingest").ingestInbound;
  const owner = randomUUID();
  const biz = `auto${tag}`;

  const graph = (nodes: unknown[], edges: unknown[]) => ({ nodes, edges });
  const at = (y: number) => ({ x: 0, y });
  async function automation(name: string, g: ReturnType<typeof graph>) {
    const { graphSchema, triggerOf } = await import("@/lib/automations/graph");
    const parsed = graphSchema.parse(g);
    const t = triggerOf(parsed)!;
    return prisma.automation.create({ data: { businessId: biz, name, status: "LIVE", graph: parsed, liveGraph: parsed, version: 1, triggerType: t.data.kind, channels: t.data.channels, publishedAt: new Date() } });
  }
  const websiteEvent = (sessionId: string, text: string, id = randomUUID()) => ({ businessId: biz, channel: "WEBSITE" as const, kind: "MESSAGE" as const, chatSessionId: sessionId, contact: { externalId: `v${tag}` }, text, externalMessageId: id });

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ ingestInbound: ingest } = await import("@/lib/inbox/ingest"));
    const { registerChannel } = await import("@/lib/inbox/channels");
    registerChannel({
      kind: "INSTAGRAM",
      capabilities: caps,
      available: async () => true,
      send: async (target, message) => (sent.dms.push({ to: target.recipientExternalId, text: message.text }), { externalId: `dm${sent.dms.length}` }),
      replyToComment: async (_t, commentId, text) => (sent.publicReplies.push({ commentId, text }), { externalId: `r${sent.publicReplies.length}` }),
      privateReply: async (_t, commentId, message) => (sent.privateReplies.push({ commentId, text: message.text }), { externalId: `p${sent.privateReplies.length}` }),
    });
    const email = `delivered+auto${tag}@resend.dev`;
    const { error } = await admin!.auth.admin.createUser({ id: owner, email, password: `Auto${tag}test1`, email_confirm: true });
    if (error) throw error;
    await prisma.user.create({ data: { id: owner, email, name: "Engine test" } });
    await prisma.business.create({ data: { id: biz, userId: owner, name: "Inzu Test" } as never });
    await prisma.contactField.create({ data: { businessId: biz, key: "size", label: "Size" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.dueJob.deleteMany({ where: { businessId: biz } });
    await prisma.business.deleteMany({ where: { id: biz } });
    await prisma.user.deleteMany({ where: { id: owner } });
    await admin!.auth.admin.deleteUser(owner).catch(() => {});
  });

  it("website: keyword -> message with buttons -> question -> tag, field and contact details", async () => {
    await automation("Menu", graph(
      [
        { id: "t", type: "trigger", position: at(0), data: { kind: "keyword", channels: ["WEBSITE"], keywords: ["menu"] } },
        { id: "m", type: "message", position: at(1), data: { text: "Hi {{first_name}}! What would you like?", buttons: [{ id: "b1", title: "Order" }, { id: "b2", title: "Prices" }] } },
        { id: "q", type: "question", position: at(2), data: { text: "Your phone number?", saveTo: "phone", validate: "phone" } },
        { id: "s", type: "question", position: at(3), data: { text: "Which size?", saveTo: "field", fieldKey: "size" } },
        { id: "a", type: "action", position: at(4), data: { actions: [{ kind: "add_tag", tag: "Wants to order" }] } },
        { id: "e", type: "message", position: at(5), data: { text: "Thanks, we will call you." } },
      ],
      [
        { id: "1", source: "t", target: "m" },
        { id: "2", source: "m", sourceHandle: "b1", target: "q" },
        { id: "3", source: "q", sourceHandle: "answered", target: "s" },
        { id: "4", source: "s", sourceHandle: "answered", target: "a" },
        { id: "5", source: "a", target: "e" },
      ],
    ));
    const session = await prisma.chatSession.create({ data: { businessId: biz, visitorId: `v${tag}` } });

    const first = await ingest(websiteEvent(session.id, "Can I see the MENU?"));
    expect(first.handled).toBe(true);
    expect(first.replies.map((r) => r.text)).toEqual(["Hi! What would you like?"]);
    expect(first.replies[0].buttons?.map((b) => b.title)).toEqual(["Order", "Prices"]);

    const order = await ingest(websiteEvent(session.id, "Order"));
    expect(order.replies.map((r) => r.text)).toEqual(["Your phone number?"]);

    const wrong = await ingest(websiteEvent(session.id, "no"));
    expect(wrong.replies[0].text).toMatch(/did not get that/);

    await ingest(websiteEvent(session.id, "it is 0788 123 456"));
    const done = await ingest(websiteEvent(session.id, "M"));
    expect(done.replies.map((r) => r.text)).toEqual(["Thanks, we will call you."]);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: done.contactId }, include: { tags: { include: { tag: true } } } });
    expect(contact.phone).toBeTruthy();
    expect(contact.fields).toEqual({ size: "M" });
    expect(contact.tags.map((t) => t.tag.name)).toEqual(["Wants to order"]);
    const run = await prisma.automationRun.findFirstOrThrow({ where: { businessId: biz, contactId: contact.id } });
    expect(run.status).toBe("DONE");
    // The website channel wrote every reply into the chat itself, so the bubble shows them.
    const chat = await prisma.chatMessage.findMany({ where: { sessionId: session.id, role: "assistant" } });
    expect(chat).toHaveLength(5);
  });

  it("stores the same platform message once", async () => {
    const session = await prisma.chatSession.create({ data: { businessId: biz, visitorId: `v${tag}` } });
    const id = randomUUID();
    const a = await ingest(websiteEvent(session.id, "hello", id));
    const b = await ingest(websiteEvent(session.id, "hello", id));
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(await prisma.message.count({ where: { conversationId: a.conversationId, direction: "INBOUND" } })).toBe(1);
  });

  it("a wait step resumes from the due jobs, and a hand-over keeps automations quiet", async () => {
    await automation("Later", graph(
      [
        { id: "t", type: "trigger", position: at(0), data: { kind: "keyword", channels: ["WEBSITE"], keywords: ["later"] } },
        { id: "w", type: "wait", position: at(1), data: { minutes: 5 } },
        { id: "m", type: "message", position: at(2), data: { text: "Still interested?" } },
        { id: "h", type: "handover", position: at(3), data: { text: "A person will answer you.", note: "Follow up" } },
      ],
      [
        { id: "1", source: "t", target: "w" },
        { id: "2", source: "w", target: "m" },
        { id: "3", source: "m", target: "h" },
      ],
    ));
    const session = await prisma.chatSession.create({ data: { businessId: biz, visitorId: `v${tag}` } });
    const r = await ingest(websiteEvent(session.id, "maybe later"));
    expect(r.replies).toEqual([]);
    const job = await prisma.dueJob.findFirstOrThrow({ where: { businessId: biz, kind: "automation.resume", status: "PENDING" } });
    // Make it due now and run the jobs.
    await prisma.dueJob.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await import("@/lib/jobs/handlers");
    const { runDueJobs } = await import("@/lib/jobs/due");
    const ran = await runDueJobs();
    expect(ran.ran).toBeGreaterThanOrEqual(1);
    const texts = (await prisma.message.findMany({ where: { conversationId: r.conversationId, direction: "OUTBOUND" }, orderBy: { createdAt: "asc" } })).map((m) => m.text);
    expect(texts).toEqual(["Still interested?", "A person will answer you.", "Follow up"]);
    const quiet = await ingest(websiteEvent(session.id, "later later"));
    expect(quiet).toMatchObject({ handled: true, paused: true, replies: [] });
  });

  it("instagram comment: public reply, private reply, then waits for the DM before going on", async () => {
    await automation("Comment PRICE", graph(
      [
        { id: "t", type: "trigger", position: at(0), data: { kind: "comment_keyword", channels: ["INSTAGRAM"], keywords: ["price"], publicReplies: ["Sent you a DM!"] } },
        { id: "m", type: "message", position: at(1), data: { text: "The dress is 25,000 RWF.", buttons: [{ id: "b1", title: "Buy" }] } },
        { id: "q", type: "question", position: at(2), data: { text: "Your phone?", saveTo: "phone", validate: "phone" } },
      ],
      [
        { id: "1", source: "t", target: "m" },
        { id: "2", source: "m", sourceHandle: "b1", target: "q" },
      ],
    ));
    const who = { externalId: `ig${tag}`, handle: "aline.rw" };
    const comment = await ingest({ businessId: biz, channel: "INSTAGRAM", kind: "COMMENT", contact: who, text: "PRICE please", externalMessageId: `c${tag}`, postExternalId: "post1" });
    expect(comment.handled).toBe(true);
    expect(sent.publicReplies).toEqual([{ commentId: `c${tag}`, text: "Sent you a DM!" }]);
    expect(sent.privateReplies).toEqual([{ commentId: `c${tag}`, text: "The dress is 25,000 RWF.\n\n1. Buy" }]);

    // The person answers in the DM thread: "1" is the first button.
    const dm = await ingest({ businessId: biz, channel: "INSTAGRAM", kind: "MESSAGE", contact: who, threadExternalId: `t${tag}`, text: "1", externalMessageId: `d${tag}` });
    expect(dm.handled).toBe(true);
    expect(dm.conversationId).not.toBe(comment.conversationId);
    expect(sent.dms.map((d) => d.text)).toEqual(["Your phone?"]);
    expect(sent.dms[0].to).toBe(`ig${tag}`);
  });

  it("without private replies the first message goes out as a public reply, then waits for a DM", async () => {
    caps.privateReply = false;
    const who = { externalId: `ig2${tag}`, handle: "eric.rw" };
    const before = sent.publicReplies.length;
    const comment = await ingest({ businessId: biz, channel: "INSTAGRAM", kind: "COMMENT", contact: who, text: "price?", externalMessageId: `c2${tag}`, postExternalId: "post1" });
    expect(comment.handled).toBe(true);
    expect(sent.publicReplies.slice(before).map((r) => r.text)).toEqual(["Sent you a DM!", "The dress is 25,000 RWF.\n\n1. Buy"]);
    const run = await prisma.automationRun.findFirstOrThrow({ where: { businessId: biz, contactId: comment.contactId } });
    expect(run.status).toBe("WAITING");
  });
});
