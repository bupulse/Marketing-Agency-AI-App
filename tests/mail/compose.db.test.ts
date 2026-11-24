import { afterAll, describe, expect, it, vi } from "vitest";
import type { MailMe } from "@/lib/mail/session";

// Drafts, department sends and Undo against the real TEST database, with Storage mocked. Nothing is delivered: every
// send is undone inside its 10 s window, and the people are delivered+…@resend.dev test addresses. Skipped unless asked:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/mail/compose.db.test.ts
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL);

vi.mock("@/lib/mail/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => new Uint8Array()),
  removeObjects: vi.fn(async () => undefined),
  createUploadSlot: vi.fn(async () => ({ signedUrl: "https://example.invalid/upload", token: "t" })),
  objectSize: vi.fn(async () => 1234),
  pathSafe: (n: string) => n.replace(/[^\w.-]+/g, "_"),
}));

const tag = `c${Date.now().toString(36)}`;
const me: MailMe = {
  userId: "00000000-0000-0000-0000-000000000000", email: "cyusa@bupulse.com", name: "Cyusa", memberId: "mm_cyusa", isOwner: true, isAdmin: true, isSuper: true,
  mailboxIds: ["mbx_cyusa"], departmentIds: ["dep_sales"], photoPath: null, prefs: {},
};

describe.skipIf(!enabled)("compose: drafts, departments, undo", { timeout: 120_000 }, async () => {
  const { prisma } = await import("@/lib/db");
  const { saveDraft, loadDraft, discardDraft, startAttachment, finishAttachment, removeAttachment } = await import("@/lib/mail/drafts");
  const { queueMessage, undoSend, sendsLeftToday } = await import("@/lib/mail/send");
  const members = [`mm_${tag}_1`, `mm_${tag}_2`];

  afterAll(async () => {
    await prisma.mailThread.deleteMany({ where: { subject: { startsWith: tag } } });
    await prisma.mailMember.deleteMany({ where: { id: { in: members } } });
  });

  it("autosaves a department draft, sends one personal email each, and Undo brings the draft back", async () => {
    await prisma.mailMember.createMany({
      data: [
        { id: members[0], email: `delivered+${tag}1@resend.dev`, name: "Alice Tester", departmentId: "dep_sales", status: "active", createdBy: tag },
        { id: members[1], email: `delivered+${tag}2@resend.dev`, name: "Bruno Tester", departmentId: "dep_sales", status: "active", createdBy: tag },
      ],
    });
    const base = { from: "mbx_cyusa", to: ["dept:dep_sales"], cc: [], bcc: [], subject: `${tag} targets`, text: "Targets for {first_name}", mode: "new" as const };
    const first = await saveDraft(me, { ...base, html: "<p>Targets for {first_name}</p><script>alert(1)</script>" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = await saveDraft(me, { ...base, draftId: first.draftId, html: "<p>Targets for {first_name}</p>" });
    expect(again.ok && again.draftId).toBe(first.draftId);
    const draftRow = await prisma.mailMessage.findUnique({ where: { id: first.draftId }, include: { thread: true } });
    expect(draftRow?.status).toBe("draft");
    expect(draftRow?.thread.folder).toBe("drafts");
    expect(draftRow?.thread.hasDraft).toBe(true);

    const opened = await loadDraft(me, first.draftId);
    expect(opened?.to).toEqual(["dept:dep_sales"]);
    expect(opened?.html).not.toContain("script");

    // Attaching: a slot, then the file joins the draft (the bucket is mocked).
    const slot = await startAttachment(me, first.draftId, { filename: "plan.pdf", size: 1234 });
    expect(slot.ok).toBe(true);
    if (!slot.ok) return;
    expect(slot.path.startsWith(`out/${first.draftId}/`)).toBe(true);
    const att = await finishAttachment(me, first.draftId, { path: slot.path, filename: "plan.pdf", contentType: "application/pdf" });
    expect(att.ok).toBe(true);
    expect((await startAttachment(me, first.draftId, { filename: "big.zip", size: 25 * 1024 * 1024 })).ok).toBe(false);

    const before = await sendsLeftToday();
    const sent = await queueMessage(me, { fromMailboxId: "mbx_cyusa", to: [], cc: [], bcc: [], subject: base.subject, text: base.text, html: "<p>Targets for {first_name}</p>", departments: ["dep_sales"], draftId: first.draftId, composer: { v: 1, to: base.to, cc: [], bcc: [], subject: base.subject, body: "<p>Targets for {first_name}</p>", parentId: null, mode: "new", dropped: [] } });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    // Read what was queued, then undo at once (well inside the 10 s window), and only then check.
    const leftAfter = await sendsLeftToday();
    const queued = await prisma.mailMessage.findMany({ where: { threadId: sent.threadId, status: "queued" }, include: { attachments: true }, orderBy: { createdAt: "asc" } });
    const draftGone = !(await prisma.mailMessage.findUnique({ where: { id: first.draftId } }));
    const back = await undoSend(me, sent.messageId);
    expect(back).toBe(sent.messageId);
    expect(sent.count).toBe(2);
    expect(leftAfter).toBe(before - 2);
    expect(queued).toHaveLength(2);
    expect(queued.map((q) => (q.to as { address: string }[])[0].address).sort()).toEqual([`delivered+${tag}1@resend.dev`, `delivered+${tag}2@resend.dev`]);
    for (const q of queued) {
      const first = (q.to as { name: string }[])[0].name.split(" ")[0];
      expect(q.html).toContain(`Hello ${first},`);
      expect(q.html).toContain(`Targets for ${first}`);
      expect(q.subject).toBe(base.subject);
      expect(q.html).not.toContain("{first_name}");
      expect(q.attachments.map((a) => a.path)).toEqual([slot.path]);
    }
    expect(sent.threadId).toBe(draftRow?.threadId);
    expect(draftGone).toBe(true);

    const left = await prisma.mailMessage.findMany({ where: { threadId: sent.threadId } });
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe("draft");
    const thread = await prisma.mailThread.findUnique({ where: { id: sent.threadId } });
    expect(thread).toMatchObject({ messageCount: 0, folder: "drafts", hasDraft: true });
    expect((await loadDraft(me, back!))?.to).toEqual(["dept:dep_sales"]);

    const files = await prisma.mailAttachment.findMany({ where: { messageId: back! } });
    expect(await removeAttachment(me, files[0].id)).toBe(true);
    expect(await discardDraft(me, back!)).toBe(true);
    expect(await prisma.mailThread.findUnique({ where: { id: sent.threadId } })).toBeNull();
  });

  it("refuses departments the person may not send to, and Cc with a department", async () => {
    const member: MailMe = { ...me, isOwner: false, isAdmin: false, isSuper: false, departmentIds: [] };
    const r = await queueMessage(member, { fromMailboxId: "mbx_cyusa", to: [], cc: [], bcc: [], subject: `${tag} no`, text: "x", departments: ["dep_sales"] });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/may not send/) });
    const e = await queueMessage(me, { fromMailboxId: "mbx_cyusa", to: [], cc: [{ name: "", address: "a@b.rw" }], bcc: [], subject: `${tag} no`, text: "x", departments: ["dep_sales"] });
    expect(e).toMatchObject({ ok: false, error: expect.stringMatching(/Cc and Bcc/) });
    const all = await queueMessage(member, { fromMailboxId: "mbx_cyusa", to: [], cc: [], bcc: [], subject: `${tag} no`, text: "x", departments: ["everyone"] });
    expect(all).toMatchObject({ ok: false, error: expect.stringMatching(/owner and Mail admins/) });
  });
});
