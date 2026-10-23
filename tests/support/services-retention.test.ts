import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    $executeRaw: vi.fn(),
    supportVisit: { updateMany: vi.fn() },
    supportPageHit: { deleteMany: vi.fn() },
    supportAttachment: { findMany: vi.fn(), deleteMany: vi.fn() },
    supportConversation: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    supportEvent: { createMany: vi.fn(), create: vi.fn() },
    supportMessage: { findMany: vi.fn(), findFirst: vi.fn() },
    adminSetting: { findUnique: vi.fn() },
    dueJob: { createMany: vi.fn() },
  },
  removeObjects: vi.fn(),
  scheduleJob: vi.fn(),
  judge: vi.fn(),
  email: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: m.scheduleJob, registerJobHandler: vi.fn() }));
vi.mock("@/lib/support/storage", () => ({ removeObjects: m.removeObjects }));
vi.mock("@/lib/support/answer", () => ({ JOB_JUDGE: "support.judge", historyFor: (rows: { body: string }[]) => rows.map((r) => ({ from: "visitor", text: r.body })) }));
vi.mock("@/lib/support/ai", () => ({ judgeResolved: m.judge }));
vi.mock("@/lib/support/alerts", () => ({ emailWaitingChat: m.email }));
vi.mock("@/lib/support/emails", () => ({ JOB_REPLY_EMAIL: "support.reply_email", JOB_TRANSCRIPT: "support.transcript", sendReplyEmail: vi.fn(), sendTicketEmail: vi.fn(), sendTranscriptEmail: vi.fn() }));
vi.mock("@/lib/support/handover", () => ({ JOB_ALERT: "support.alert", JOB_TICKET: "support.ticket" }));

import { runAlert, runJudge } from "@/lib/support/jobs";
import { AI_CHAT_IDLE_CLOSE_MS, IP_RETENTION_MS, JUDGE_AFTER_MS, PAGE_HIT_RETENTION_MS, UPLOAD_SLOT_MS, VISIT_IDLE_MS } from "@/lib/support/limits";
import { sweepCutoffs, sweepSupport } from "@/lib/support/retention";

const NOW = new Date("2026-10-26T10:00:00Z"); // a Monday, 12:00 in Kigali: team open
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function nothingToDo() {
  m.prisma.$executeRaw.mockResolvedValue(0);
  m.prisma.supportVisit.updateMany.mockResolvedValue({ count: 0 });
  m.prisma.supportPageHit.deleteMany.mockResolvedValue({ count: 0 });
  m.prisma.supportAttachment.findMany.mockResolvedValue([]);
  m.prisma.supportAttachment.deleteMany.mockResolvedValue({ count: 0 });
  m.prisma.supportConversation.findMany.mockResolvedValue([]);
  m.prisma.supportConversation.updateMany.mockResolvedValue({ count: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  nothingToDo();
  m.removeObjects.mockResolvedValue(undefined);
  m.prisma.adminSetting.findUnique.mockResolvedValue(null); // default settings: Mon-Sat 08:00-20:00 Kigali
  m.prisma.supportEvent.createMany.mockResolvedValue({ count: 0 });
  m.prisma.supportEvent.create.mockResolvedValue({});
});

describe("sweepCutoffs", () => {
  it("are now minus each retention period", () => {
    const c = sweepCutoffs(NOW);
    expect(c.visitIdle).toEqual(ago(VISIT_IDLE_MS));
    expect(c.ip).toEqual(ago(IP_RETENTION_MS));
    expect(c.pageHits).toEqual(ago(PAGE_HIT_RETENTION_MS));
    expect(c.uploadSlot).toEqual(ago(UPLOAD_SLOT_MS));
    expect(c.aiChat).toEqual(ago(AI_CHAT_IDLE_CLOSE_MS));
    expect(IP_RETENTION_MS).toBe(30 * 86_400_000);
    expect(VISIT_IDLE_MS).toBe(20 * 60_000);
  });
});

describe("sweepSupport", () => {
  it("closes idle visits, cuts old IPs, drops old page hits", async () => {
    m.prisma.$executeRaw.mockResolvedValue(3);
    m.prisma.supportVisit.updateMany.mockResolvedValue({ count: 2 });
    m.prisma.supportPageHit.deleteMany.mockResolvedValue({ count: 7 });
    const r = await sweepSupport(NOW);
    expect(r).toMatchObject({ visitsClosed: 3, ipsCleared: 2, pageHitsDeleted: 7 });
    // The idle-visit update gets the 20-minute cut-off as its parameter.
    expect(m.prisma.$executeRaw.mock.calls[0].slice(1)).toEqual([ago(VISIT_IDLE_MS)]);
    const ipCall = m.prisma.supportVisit.updateMany.mock.calls[0][0];
    expect(ipCall.where.startedAt).toEqual({ lt: ago(30 * 86_400_000) });
    expect(ipCall.data).toEqual({ ip: null, city: null, region: null });
    expect(m.prisma.supportPageHit.deleteMany).toHaveBeenCalledWith({ where: { at: { lt: ago(30 * 86_400_000) } } });
  });

  it("removes expired and abandoned files from storage, then their rows", async () => {
    m.prisma.supportAttachment.findMany.mockResolvedValue([{ id: "f1", storagePath: "conv/c1/f1.png" }, { id: "f2", storagePath: "conv/c2/f2.pdf" }]);
    m.prisma.supportAttachment.deleteMany.mockResolvedValue({ count: 2 });
    const r = await sweepSupport(NOW);
    const where = m.prisma.supportAttachment.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ expiresAt: { lt: NOW } }, { uploadedAt: null, createdAt: { lt: ago(UPLOAD_SLOT_MS) } }]);
    expect(m.removeObjects).toHaveBeenCalledWith(["conv/c1/f1.png", "conv/c2/f2.pdf"]);
    expect(m.prisma.supportAttachment.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["f1", "f2"] } } });
    expect(m.removeObjects.mock.invocationCallOrder[0]).toBeLessThan(m.prisma.supportAttachment.deleteMany.mock.invocationCallOrder[0]);
    expect(r.filesDeleted).toBe(2);
  });

  it("keeps the rows when storage fails, for the next run", async () => {
    m.prisma.supportAttachment.findMany.mockResolvedValue([{ id: "f1", storagePath: "conv/c1/f1.png" }]);
    m.removeObjects.mockRejectedValue(new Error("storage down"));
    const r = await sweepSupport(NOW);
    expect(m.prisma.supportAttachment.deleteMany).not.toHaveBeenCalled();
    expect(r.filesDeleted).toBe(0);
  });

  it("closes AI chats idle for a day and asks the judge about each", async () => {
    m.prisma.supportConversation.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    const r = await sweepSupport(NOW);
    expect(m.prisma.supportConversation.findMany.mock.calls[0][0].where).toEqual({ status: "AI", lastMessageAt: { lt: ago(AI_CHAT_IDLE_CLOSE_MS) } });
    expect(m.prisma.supportConversation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["c1", "c2"] }, status: "AI" }, data: { status: "CLOSED", closedAt: NOW, closedBy: "system" } });
    expect(m.scheduleJob).toHaveBeenCalledTimes(2);
    expect(m.scheduleJob).toHaveBeenCalledWith({ kind: "support.judge", runAt: NOW, payload: { conversationId: "c1" }, dedupeKey: "support.judge:c1" });
    expect(r.chatsClosed).toBe(2);
  });

  it("is idempotent: with nothing left to do it changes nothing", async () => {
    const r = await sweepSupport(NOW);
    expect(r).toEqual({ visitsClosed: 0, ipsCleared: 0, pageHitsDeleted: 0, filesDeleted: 0, chatsClosed: 0 });
    expect(m.removeObjects).not.toHaveBeenCalled();
    expect(m.prisma.supportAttachment.deleteMany).not.toHaveBeenCalled();
    expect(m.prisma.supportEvent.createMany).not.toHaveBeenCalled();
    expect(m.scheduleJob).not.toHaveBeenCalled();
  });
});

describe("runJudge", () => {
  const chat = (over: Record<string, unknown> = {}) => ({ status: "CLOSED", handoverAt: null, agentReplyCount: 0, aiReplyCount: 2, rating: null, aiResolved: null, lastMessageAt: ago(3 * 3_600_000), ...over });
  beforeEach(() => {
    m.prisma.supportConversation.updateMany.mockResolvedValue({ count: 1 });
    m.prisma.supportMessage.findMany.mockResolvedValue([{ author: "VISITOR", kind: "TEXT", body: "How much is it?", attachment: null }]);
  });

  it("a chat a person touched is not an AI resolution, and the AI is not asked", async () => {
    m.prisma.supportConversation.findUnique.mockResolvedValue(chat({ handoverAt: ago(60_000) }));
    await runJudge({ conversationId: "c1" }, NOW);
    expect(m.prisma.supportConversation.updateMany).toHaveBeenCalledWith({ where: { id: "c1", aiResolved: null }, data: { aiResolved: false } });
    expect(m.judge).not.toHaveBeenCalled();
    m.prisma.supportConversation.findUnique.mockResolvedValue(chat({ agentReplyCount: 1 }));
    await runJudge({ conversationId: "c1" }, NOW);
    expect(m.judge).not.toHaveBeenCalled();
  });

  it("a thumbs up counts as resolved without the AI", async () => {
    m.prisma.supportConversation.findUnique.mockResolvedValue(chat({ rating: 1 }));
    await runJudge({ conversationId: "c1" }, NOW);
    expect(m.prisma.supportConversation.updateMany).toHaveBeenCalledWith({ where: { id: "c1", aiResolved: null }, data: { aiResolved: true } });
    expect(m.prisma.supportEvent.create).toHaveBeenCalledWith({ data: { name: "ai_resolved", conversationId: "c1", at: NOW } });
    expect(m.judge).not.toHaveBeenCalled();
  });

  it("an open chat with a recent message waits: the judge is moved to 2 hours after it", async () => {
    const last = ago(30 * 60_000);
    m.prisma.supportConversation.findUnique.mockResolvedValue(chat({ status: "AI", lastMessageAt: last }));
    await runJudge({ conversationId: "c1" }, NOW);
    expect(m.scheduleJob).toHaveBeenCalledWith({ kind: "support.judge", runAt: new Date(last.getTime() + JUDGE_AFTER_MS), payload: { conversationId: "c1" }, dedupeKey: "support.judge:c1" });
    expect(m.judge).not.toHaveBeenCalled();
    expect(m.prisma.supportConversation.updateMany).not.toHaveBeenCalled();
  });

  it("otherwise asks the AI and saves its verdict", async () => {
    m.prisma.supportConversation.findUnique.mockResolvedValue(chat());
    m.judge.mockResolvedValue(false);
    await runJudge({ conversationId: "c1" }, NOW);
    expect(m.judge).toHaveBeenCalledWith([{ from: "visitor", text: "How much is it?" }]);
    expect(m.prisma.supportConversation.updateMany).toHaveBeenCalledWith({ where: { id: "c1", aiResolved: null }, data: { aiResolved: false } });
  });

  it("already judged, never answered by the AI, or a bad payload: nothing happens", async () => {
    m.prisma.supportConversation.findUnique.mockResolvedValue(chat({ aiResolved: true }));
    await runJudge({ conversationId: "c1" }, NOW);
    m.prisma.supportConversation.findUnique.mockResolvedValue(chat({ aiReplyCount: 0 }));
    await runJudge({ conversationId: "c1" }, NOW);
    await runJudge({}, NOW);
    expect(m.prisma.supportConversation.updateMany).not.toHaveBeenCalled();
    expect(m.judge).not.toHaveBeenCalled();
  });
});

describe("runAlert", () => {
  const handoverAt = ago(2 * 60_000);
  const payload = { conversationId: "c1", handoverAt: handoverAt.toISOString() };
  beforeEach(() => {
    m.prisma.supportConversation.findUnique.mockResolvedValue({ number: 1001, departmentId: "d1", visitor: { name: "Test Visitor", businessName: null } });
    m.prisma.supportMessage.findFirst.mockResolvedValue({ body: "Can someone help me?" });
    m.email.mockResolvedValue(1);
  });

  it("claims the hand-over once, then emails the agents on duty", async () => {
    m.prisma.supportConversation.updateMany.mockResolvedValue({ count: 1 });
    await runAlert(payload, NOW);
    expect(m.prisma.supportConversation.updateMany).toHaveBeenCalledWith({ where: { id: "c1", status: "WAITING", handoverAt, alertSentAt: null, firstHumanReplyAt: null }, data: { alertSentAt: NOW } });
    expect(m.email).toHaveBeenCalledWith({ id: "c1", number: 1001, departmentId: "d1", visitorName: "Test Visitor", preview: "Can someone help me?" });
  });

  it("sends nothing when the claim fails (already sent, answered, or a newer hand-over)", async () => {
    m.prisma.supportConversation.updateMany.mockResolvedValue({ count: 0 });
    await runAlert(payload, NOW);
    expect(m.email).not.toHaveBeenCalled();
  });

  it("sends nothing outside team hours (the ticket email covers that)", async () => {
    m.prisma.supportConversation.updateMany.mockResolvedValue({ count: 1 });
    await runAlert(payload, new Date("2026-10-25T10:00:00Z")); // a Sunday: closed
    expect(m.prisma.supportConversation.updateMany).not.toHaveBeenCalled();
    expect(m.email).not.toHaveBeenCalled();
  });

  it("ignores a payload without the hand-over time", async () => {
    await runAlert({ conversationId: "c1" }, NOW);
    expect(m.prisma.supportConversation.updateMany).not.toHaveBeenCalled();
  });
});
