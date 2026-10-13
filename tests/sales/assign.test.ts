import { beforeEach, describe, expect, it, vi } from "vitest";

// Reassigning a client: a reason is required, the person needs clients.reassign, and the change is one transaction.

const db = vi.hoisted(() => ({
  business: { findUnique: vi.fn(), update: vi.fn() },
  staffMember: { findUnique: vi.fn() },
  staffRole: { findUnique: vi.fn() },
  clientAssignment: { updateMany: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

const gate = vi.hoisted(() => ({ adminAction: vi.fn(), done: vi.fn() }));
vi.mock("@/lib/admin/console", () => ({
  adminAction: gate.adminAction,
  // The real finish() redirects with ?notice= / ?error=; here it records the outcome.
  finish: async (_back: string, _ok: string, fn: () => Promise<unknown>) => {
    try {
      gate.done(await fn());
    } catch (e) {
      gate.done(e);
    }
  },
}));

import { cleanReason } from "@/lib/sales/assign-rules";
import { reassign } from "@/lib/sales/assign";
import { reassignClientAction } from "@/app/admin/(console)/(sales)/sales/team/actions";
import { AdminError } from "@/lib/admin/types";

const ctx = { actor: "staff:m1", ip: null, viaApi: false };
const now = new Date("2026-10-15T09:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.business.findUnique.mockResolvedValue({ id: "b1", userId: "u1", name: "Acme", salesAgentId: "A" });
  db.staffMember.findUnique.mockResolvedValue({ id: "B", status: "active", roleKey: "sales_agent" });
  db.staffRole.findUnique.mockResolvedValue(null);
  db.clientAssignment.create.mockResolvedValue({ id: "ca2" });
});

describe("reason", () => {
  it("is required: 3 to 200 characters", () => {
    expect(() => cleanReason("")).toThrow(AdminError);
    expect(() => cleanReason("  ok ")).toThrow(AdminError);
    expect(() => cleanReason("x".repeat(201))).toThrow(AdminError);
    expect(cleanReason("  agent   left ")).toBe("agent left");
  });

  it("refuses a reassignment without one, before touching anything", async () => {
    await expect(reassign(ctx, { businessId: "b1", staffId: "B", reason: "" })).rejects.toThrow(/reason/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("reassign", () => {
  it("closes the open assignment now, opens a new one, sets the agent and audits it", async () => {
    await reassign(ctx, { businessId: "b1", staffId: "B", reason: "Client asked" }, now);
    expect(db.clientAssignment.updateMany).toHaveBeenCalledWith({ where: { businessId: "b1", endsAt: null }, data: { endsAt: now } });
    expect(db.clientAssignment.create).toHaveBeenCalledWith({ data: { businessId: "b1", userId: "u1", staffId: "B", startsAt: now, source: "manager", reason: "Client asked", by: "staff:m1" } });
    expect(db.business.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { salesAgentId: "B" } });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actor: "staff:m1", action: "client.reassign", target: "b1" }) });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("can leave a client unassigned", async () => {
    await reassign(ctx, { businessId: "b1", staffId: null, reason: "Agent left" }, now);
    expect(db.business.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { salesAgentId: null } });
  });

  it("refuses a disabled or non-sales staff member, an unknown client and no change", async () => {
    db.staffMember.findUnique.mockResolvedValueOnce({ id: "B", status: "disabled", roleKey: "sales_agent" });
    await expect(reassign(ctx, { businessId: "b1", staffId: "B", reason: "Because" })).rejects.toThrow(AdminError);
    db.staffMember.findUnique.mockResolvedValueOnce({ id: "F", status: "active", roleKey: "finance" });
    await expect(reassign(ctx, { businessId: "b1", staffId: "F", reason: "Because" })).rejects.toThrow(AdminError);
    db.business.findUnique.mockResolvedValueOnce(null);
    await expect(reassign(ctx, { businessId: "nope", staffId: "B", reason: "Because" })).rejects.toThrow(/not found/);
    await expect(reassign(ctx, { businessId: "b1", staffId: "A", reason: "Because" })).rejects.toThrow(/already/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("the server action", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it("needs clients.reassign", async () => {
    gate.adminAction.mockResolvedValue(ctx);
    await reassignClientAction(form({ businessId: "b1", staffId: "B", reason: "Client asked" }));
    expect(gate.adminAction).toHaveBeenCalledWith("clients.reassign");
    expect(db.clientAssignment.create).toHaveBeenCalled();
  });

  it("changes nothing for someone without it", async () => {
    gate.adminAction.mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(reassignClientAction(form({ businessId: "b1", staffId: "B", reason: "Client asked" }))).rejects.toThrow();
    expect(db.business.findUnique).not.toHaveBeenCalled();
    expect(db.clientAssignment.create).not.toHaveBeenCalled();
  });

  it("reports a missing reason instead of changing anything; an empty agent means unassigned", async () => {
    gate.adminAction.mockResolvedValue(ctx);
    await reassignClientAction(form({ businessId: "b1", staffId: "", reason: "" }));
    expect(gate.done.mock.calls[0][0]).toBeInstanceOf(AdminError);
    await reassignClientAction(form({ businessId: "b1", staffId: "", reason: "Agent left" }));
    expect(db.business.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { salesAgentId: null } });
  });
});
