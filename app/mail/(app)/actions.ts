"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseAddressList, type Addr } from "@/lib/mail/addresses";
import { actOnThreads, type ThreadAction } from "@/lib/mail/queries";
import { deliverDue, queueMessage, undoSend, UNDO_SECONDS } from "@/lib/mail/send";
import { requireMail } from "@/lib/mail/session";

// B Mail's server actions. Each one checks the person again (requireMail): server actions are public POST endpoints.

export type SendInput = { from: string; to: string; cc: string; bcc: string; subject: string; text: string; parentId?: string | null; mode?: "new" | "reply" | "all" | "forward" };
export type SendState = { ok: true; messageId: string; threadId: string; undoSeconds: number } | { ok: false; error: string };

const list = (raw: string, field: string): Addr[] | string => {
  const { list: l, invalid } = parseAddressList(raw ?? "");
  return invalid.length ? `${field}: "${invalid[0]}" is not an email address.` : l;
};

export async function sendMailAction(input: SendInput): Promise<SendState> {
  const me = await requireMail();
  const to = list(input.to, "To");
  const cc = list(input.cc, "Cc");
  const bcc = list(input.bcc, "Bcc");
  for (const x of [to, cc, bcc]) if (typeof x === "string") return { ok: false, error: x };
  const subject = (input.subject ?? "").trim() || "(no subject)";
  const r = await queueMessage(me, { fromMailboxId: input.from, to: to as Addr[], cc: cc as Addr[], bcc: bcc as Addr[], subject, text: input.text ?? "", parentId: input.parentId ?? null, mode: input.mode ?? "new" });
  if (!r.ok) return r;
  // Deliver right after the undo window, from this request; page loads and the cron route catch anything left.
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, UNDO_SECONDS * 1000 + 800));
    await deliverDue();
  });
  revalidatePath("/mail");
  return { ok: true, messageId: r.messageId, threadId: r.threadId, undoSeconds: UNDO_SECONDS };
}

export async function undoSendAction(messageId: string): Promise<{ ok: boolean }> {
  const me = await requireMail();
  const ok = await undoSend(me, messageId);
  revalidatePath("/mail");
  return { ok };
}

export async function threadAction(ids: string[], action: ThreadAction): Promise<{ count: number }> {
  const me = await requireMail();
  const count = await actOnThreads(me, ids, action);
  // Report spam / Not spam also teaches the sender rules for next time.
  if ((action === "spam" || action === "notspam") && ids.length) {
    const senders = await prisma.mailMessage.findMany({ where: { threadId: { in: ids }, direction: "in", mailboxId: { in: me.mailboxIds } }, select: { fromAddress: true }, distinct: ["fromAddress"], take: 20 });
    for (const s of senders) {
      await prisma.mailSenderRule.upsert({ where: { pattern: s.fromAddress }, create: { pattern: s.fromAddress, action: action === "spam" ? "spam" : "allow", createdBy: me.email }, update: { action: action === "spam" ? "spam" : "allow" } });
    }
  }
  revalidatePath("/mail");
  return { count };
}
