import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mailUserOrNull } from "@/lib/mail/session";

// For the new-mail notices (Settings > Notifications): how many unread conversations are in the person's inboxes,
// and the newest one. Signed-in B Mail users only; nothing is cached.
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await mailUserOrNull();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const where = { mailboxId: { in: me.mailboxIds }, folder: "inbox", unread: true };
  const [unread, latest] = await Promise.all([
    prisma.mailThread.count({ where }),
    prisma.mailThread.findFirst({ where, orderBy: { lastMessageAt: "desc" }, select: { id: true, subject: true, messages: { where: { direction: "in" }, orderBy: { date: "desc" }, take: 1, select: { fromName: true, fromAddress: true } } } }),
  ]);
  const from = latest?.messages[0];
  return NextResponse.json({ unread, latest: latest ? { id: latest.id, subject: latest.subject || "(no subject)", from: from?.fromName || from?.fromAddress || "" } : null }, { headers: { "cache-control": "no-store" } });
}
