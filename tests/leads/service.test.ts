import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  chatSession: { findFirst: vi.fn() },
  lead: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));
const tasks = vi.hoisted(() => [] as (() => Promise<unknown>)[]);
vi.mock("@/lib/leads/background", () => ({ runInBackground: (task: () => Promise<unknown>) => void tasks.push(task) }));
const notifyNewLead = vi.hoisted(() => vi.fn(async () => ({ emailed: true, webhook: false })));
vi.mock("@/lib/leads/notify", () => ({ notifyNewLead }));

import { Prisma } from "@/lib/generated/prisma/client";
import { LeadError, createLeadFromChat, deleteLeads, getLeadDetail, setLeadNotes, setLeadStatus } from "@/lib/leads/service";

beforeEach(() => {
  for (const group of Object.values(prisma)) for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset();
  notifyNewLead.mockClear();
  tasks.length = 0;
  prisma.chatSession.findFirst.mockResolvedValue({ id: "s1" });
});

const input = { businessId: "b1", sessionId: "s1" };

describe("createLeadFromChat", () => {
  it("creates a cleaned lead and notifies once", async () => {
    prisma.lead.findUnique.mockResolvedValue(null);
    prisma.lead.create.mockResolvedValue({ id: "l1" });
    prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    const result = await createLeadFromChat({ ...input, name: " Jane ", email: "JANE@X.COM", phone: "+250 788 123 456", interest: "cakes", message: "", pageUrl: "javascript:alert(1)" });
    expect(result).toEqual({ id: "l1", created: true });
    expect(prisma.lead.create.mock.calls[0][0].data).toEqual({ businessId: "b1", sessionId: "s1", source: "website_chat", name: "Jane", email: "jane@x.com", phone: "+250788123456", interest: "cakes" });
    expect(prisma.lead.updateMany.mock.calls[0][0].where).toEqual({ id: "l1", notifiedAt: null });
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(notifyNewLead).toHaveBeenCalledWith("l1");
  });

  it("merges into the existing lead and never erases given details", async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: "l1" });
    prisma.lead.update.mockResolvedValue({});
    prisma.lead.updateMany.mockResolvedValue({ count: 0 }); // already notified
    const result = await createLeadFromChat({ ...input, name: "", email: "not-an-email", phone: "+250788123456", interest: null });
    expect(result).toEqual({ id: "l1", created: false });
    expect(prisma.lead.update.mock.calls[0][0].data).toEqual({ phone: "+250788123456" });
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it("a double submit sends one notification (the claim decides)", async () => {
    prisma.lead.findUnique.mockResolvedValue({ id: "l1" });
    prisma.lead.update.mockResolvedValue({});
    prisma.lead.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await Promise.all([createLeadFromChat({ ...input, name: "A" }), createLeadFromChat({ ...input, name: "A" })]);
    expect(tasks).toHaveLength(1);
  });

  it("treats a lost creation race as a merge", async () => {
    prisma.lead.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "l1" });
    prisma.lead.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    prisma.lead.update.mockResolvedValue({});
    prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    expect(await createLeadFromChat({ ...input, name: "A" })).toEqual({ id: "l1", created: false });
    expect(tasks).toHaveLength(0);
  });

  it("refuses a session of another business", async () => {
    prisma.chatSession.findFirst.mockResolvedValue(null);
    await expect(createLeadFromChat({ businessId: "b2", sessionId: "s1" })).rejects.toBeInstanceOf(LeadError);
    expect(prisma.chatSession.findFirst.mock.calls[0][0].where).toEqual({ id: "s1", businessId: "b2" });
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
});

describe("owner scoping (IDOR)", () => {
  it("every read and write includes the businessId", async () => {
    prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    prisma.lead.deleteMany.mockResolvedValue({ count: 0 });
    prisma.lead.findFirst.mockResolvedValue(null);
    await setLeadStatus("b1", ["l9"], "WON");
    await setLeadNotes("b1", "l9", "hi");
    await deleteLeads("b1", ["l9", "l9", "l8"]);
    await getLeadDetail("b1", "l9");
    expect(prisma.lead.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ["l9"] }, businessId: "b1" });
    expect(prisma.lead.updateMany.mock.calls[1][0].where).toEqual({ id: "l9", businessId: "b1" });
    expect(prisma.lead.deleteMany.mock.calls[0][0].where).toEqual({ id: { in: ["l9", "l8"] }, businessId: "b1" });
    expect(prisma.lead.findFirst.mock.calls[0][0].where).toEqual({ id: "l9", businessId: "b1" });
  });
  it("reports a lead of another business as not saved", async () => {
    prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    expect(await setLeadNotes("b1", "foreign", "x")).toBe(false);
  });
});
