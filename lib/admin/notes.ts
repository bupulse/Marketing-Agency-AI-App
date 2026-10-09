import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "./audit";
import { AdminError, type AdminContext } from "./types";

const MAX = 2000;

/** Private note about a client. The text goes to the audit log too; audit rows about the user are redacted on account deletion. */
export async function addAdminNote(ctx: AdminContext, input: { userId: string; body: string }) {
  const body = (input.body ?? "").trim();
  if (!body) throw new AdminError("invalid", "Write something in the note first.");
  if (body.length > MAX) throw new AdminError("invalid", `Keep the note under ${MAX} characters.`);
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) throw new AdminError("not_found", "No user with that id.");
  return prisma.$transaction(async (tx) => {
    const note = await tx.adminNote.create({ data: { userId: user.id, body, createdBy: ctx.actor } });
    await writeAudit(tx, ctx, "add_admin_note", `user:${user.id}`, null, { noteId: note.id, body });
    return note;
  });
}

export async function deleteAdminNote(ctx: AdminContext, noteId: string) {
  const note = await prisma.adminNote.findUnique({ where: { id: noteId } });
  if (!note) throw new AdminError("not_found", "That note does not exist.");
  await prisma.$transaction(async (tx) => {
    await tx.adminNote.delete({ where: { id: noteId } });
    await writeAudit(tx, ctx, "delete_admin_note", `user:${note.userId}`, { noteId, body: note.body }, null);
  });
  return { userId: note.userId };
}
