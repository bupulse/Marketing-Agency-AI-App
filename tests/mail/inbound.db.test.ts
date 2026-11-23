import { afterAll, describe, expect, it, vi } from "vitest";

// receiveMail against the real TEST database, with Storage mocked. Skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/mail/inbound.db.test.ts
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL);

vi.mock("@/lib/mail/storage", () => ({ putObject: vi.fn(async () => undefined), pathSafe: (n: string) => n.replace(/[^\w.-]+/g, "_") }));

const tag = `t${Date.now().toString(36)}`;
const mail = (o: { id: string; to: string; subject: string; inReplyTo?: string; from?: string; name?: string; body?: string }) =>
  [
    `From: ${o.name ?? "Test Bank"} <${o.from ?? "notices@imbank.co.rw"}>`,
    `To: ${o.to}`,
    `Subject: ${o.subject}`,
    `Message-ID: <${o.id}@${tag}.example>`,
    ...(o.inReplyTo ? [`In-Reply-To: <${o.inReplyTo}@${tag}.example>`] : []),
    "Date: Mon, 23 Nov 2026 08:00:00 +0200",
    "Content-Type: text/plain; charset=utf-8",
    "",
    o.body ?? "Your debit card is ready.",
  ].join("\r\n");
const enc = (s: string) => new TextEncoder().encode(s);

describe.skipIf(!enabled)("receiveMail", { timeout: 120_000 }, async () => {
  const { prisma } = await import("@/lib/db");
  const { receiveMail } = await import("@/lib/mail/inbound");
  const made: string[] = [];

  afterAll(async () => {
    await prisma.mailThread.deleteMany({ where: { id: { in: made } } });
    await prisma.mailForwarder.deleteMany({ where: { createdBy: tag } });
  });

  it("files a bank email in cyusa@ and copies it to accounting@", async () => {
    const r = await receiveMail({ raw: enc(mail({ id: "a1", to: "cyusa@bupulse.com", subject: `${tag} card` })), recipient: "cyusa@bupulse.com" });
    expect(r.status).toBe("stored");
    if (r.status !== "stored") return;
    expect(r.mailboxId).toBe("mbx_cyusa");
    expect(r.copies).toBe(1);
    const threads = await prisma.mailThread.findMany({ where: { subject: `${tag} card` }, select: { id: true, mailboxId: true, tags: true, copiedFrom: true, important: true } });
    made.push(...threads.map((t) => t.id));
    expect(threads.map((t) => t.mailboxId).sort()).toEqual(["mbx_accounting", "mbx_cyusa"]);
    expect(threads.find((t) => t.mailboxId === "mbx_accounting")?.copiedFrom).toBe("cyusa@bupulse.com");
    expect(threads.every((t) => t.tags.includes("bank") && t.important)).toBe(true);
  });

  it("treats the same message again as a duplicate and threads a reply", async () => {
    const again = await receiveMail({ raw: enc(mail({ id: "a1", to: "cyusa@bupulse.com", subject: `${tag} card` })), recipient: "cyusa@bupulse.com" });
    expect(again.status).toBe("duplicate");
    const reply = await receiveMail({ raw: enc(mail({ id: "a2", to: "cyusa@bupulse.com", subject: `Re: ${tag} card`, inReplyTo: "a1" })), recipient: "cyusa@bupulse.com" });
    expect(reply.status).toBe("stored");
    const t = await prisma.mailThread.findFirst({ where: { mailboxId: "mbx_cyusa", subject: `${tag} card` }, select: { messageCount: true } });
    expect(t?.messageCount).toBe(2);
  });

  it("sends unknown addresses to the catch-all and refuses other domains", async () => {
    const r = await receiveMail({ raw: enc(mail({ id: "b1", to: `nobody-${tag}@bupulse.com`, subject: `${tag} other`, from: "a@example.com", name: "Someone", body: "hello" })), recipient: `nobody-${tag}@bupulse.com` });
    expect(r.status === "stored" && r.mailboxId).toBe("mbx_other");
    const t = await prisma.mailThread.findMany({ where: { subject: `${tag} other` }, select: { id: true } });
    made.push(...t.map((x) => x.id));
    expect((await receiveMail({ raw: enc(mail({ id: "b2", to: "x@gmail.com", subject: "x" })), recipient: "x@gmail.com" })).status).toBe("refused");
  });

  it("copies to an internal forward target and returns confirmed outside targets", async () => {
    await prisma.mailForwarder.createMany({ data: [
      { source: "office@bupulse.com", target: "cyusa@bupulse.com", createdBy: tag },
      { source: "office@bupulse.com", target: `out-${tag}@example.com`, external: true, verifiedAt: new Date(), createdBy: tag },
    ] });
    const r = await receiveMail({ raw: enc(mail({ id: "c1", to: "office@bupulse.com", subject: `${tag} lunch`, from: "friend@example.com", name: "A Friend", body: "Lunch tomorrow?" })), recipient: "office@bupulse.com" });
    expect(r.status === "stored" && r.copies).toBe(1);
    expect(r.status === "stored" && r.forwardTo).toEqual([`out-${tag}@example.com`]);
    const t = await prisma.mailThread.findMany({ where: { subject: `${tag} lunch` }, select: { id: true, mailboxId: true, copyKind: true } });
    made.push(...t.map((x) => x.id));
    expect(t.find((x) => x.mailboxId === "mbx_cyusa")?.copyKind).toBe("forward");
  });
});
