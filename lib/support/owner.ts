import "server-only";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin/auth";

// The support dashboard's one admin (owner, 9 November 2026; docs/SUPPORT_DASHBOARD.md): admin@bupulse.com, signing in
// with the same account as the admin console (an emailed code and the authenticator app; no second password). Its
// SupportAgent row is made the first time it opens the support app, as a supervisor, so every chat, stat and server
// page works for it like for any agent and it is never listed twice. Other admin addresses stay out (agents.ts).
export const SUPPORT_OWNER_EMAIL = "admin@bupulse.com";

/** True for admin@bupulse.com while it is also an admin console address (ADMIN_EMAILS). */
export function isSupportOwnerEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return e === SUPPORT_OWNER_EMAIL && isAdminEmail(e);
}

/** Makes (or repairs) the owner's agent row for this sign-in: a supervisor linked to it. Anyone else: nothing. */
export async function ensureOwnerAgent(user: { id: string; email: string | null; emailConfirmed: boolean }): Promise<void> {
  if (!user.emailConfirmed || !isSupportOwnerEmail(user.email)) return;
  const email = SUPPORT_OWNER_EMAIL;
  const row = await prisma.supportAgent.findUnique({ where: { email }, select: { id: true, userId: true, role: true, status: true } });
  if (!row) {
    await prisma.supportAgent
      .create({ data: { email, name: "Admin", role: "SUPERVISOR", status: "active", userId: user.id, invitedBy: "system:owner" } })
      .catch(() => undefined); // two first visits at once: the other one made it
    return;
  }
  // A row linked to another sign-in is left alone (app-access refuses it, as for any agent).
  if (row.userId && row.userId !== user.id) return;
  if (row.userId === user.id && row.role === "SUPERVISOR" && row.status === "active") return;
  await prisma.supportAgent.update({ where: { id: row.id }, data: { userId: user.id, role: "SUPERVISOR", status: row.status === "locked" ? "locked" : "active" } });
}
