import { beforeEach, describe, expect, it, vi } from "vitest";

const { audits, tx } = vi.hoisted(() => {
  const audits: { action: string; target: string | null; before: unknown; after: unknown; actor: string }[] = [];
  const tx = {
    adminNote: { create: vi.fn(), delete: vi.fn() },
    auditLog: {},
  };
  return { audits, tx };
});

vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (_db: unknown, ctx: { actor: string }, action: string, target: string | null, before: unknown, after: unknown) => { audits.push({ actor: ctx.actor, action, target, before, after }); },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === "00000000-0000-4000-8000-000000000001" ? { id: where.id } : null)) },
    adminNote: { findUnique: vi.fn(async () => ({ id: "n1", userId: "00000000-0000-4000-8000-000000000001", body: "old text" })) },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));

const { addAdminNote, deleteAdminNote } = await import("@/lib/admin/notes");
const ctx = { actor: "admin", ip: "1.2.3.4", viaApi: false };
const U = "00000000-0000-4000-8000-000000000001";

beforeEach(() => { audits.length = 0; tx.adminNote.create.mockReset(); tx.adminNote.delete.mockReset(); });

describe("admin notes are audited", () => {
  it("writes the note and its audit row together, targeted at the user", async () => {
    tx.adminNote.create.mockResolvedValue({ id: "n1", userId: U, body: "Called, wants a refund", createdBy: "admin" });
    await addAdminNote(ctx, { userId: U, body: "  Called, wants a refund  " });
    expect(tx.adminNote.create).toHaveBeenCalledWith({ data: { userId: U, body: "Called, wants a refund", createdBy: "admin" } });
    // target user:<id> is what redact_audit_for_user erases when the account is deleted.
    expect(audits).toEqual([{ actor: "admin", action: "add_admin_note", target: `user:${U}`, before: null, after: { noteId: "n1", body: "Called, wants a refund" } }]);
  });

  it("audits a deletion with the old text", async () => {
    await deleteAdminNote(ctx, "n1");
    expect(tx.adminNote.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
    expect(audits[0]).toMatchObject({ action: "delete_admin_note", target: `user:${U}`, before: { noteId: "n1", body: "old text" }, after: null });
  });

  it("refuses an empty note, a very long one and an unknown user, without writing anything", async () => {
    await expect(addAdminNote(ctx, { userId: U, body: "   " })).rejects.toMatchObject({ code: "invalid" });
    await expect(addAdminNote(ctx, { userId: U, body: "x".repeat(2001) })).rejects.toMatchObject({ code: "invalid" });
    await expect(addAdminNote(ctx, { userId: "00000000-0000-4000-8000-000000000009", body: "hi" })).rejects.toMatchObject({ code: "not_found" });
    expect(tx.adminNote.create).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });
});
