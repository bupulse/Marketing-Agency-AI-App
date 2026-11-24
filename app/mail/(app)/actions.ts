"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseAddressList, type Addr } from "@/lib/mail/addresses";
import { actOnThreads, type ThreadAction } from "@/lib/mail/queries";
import { deliverDue, queueMessage, undoSend, UNDO_SECONDS } from "@/lib/mail/send";
import { requireMail } from "@/lib/mail/session";

// B Mail's server actions. Each one checks the person again (requireMail): server actions are public POST endpoints.

export type SendInput = { from: string; to: string; cc: string; bcc: string; subject: string; text: string; html?: string; parentId?: string | null; mode?: "new" | "reply" | "all" | "forward" };
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
  const r = await queueMessage(me, { fromMailboxId: input.from, to: to as Addr[], cc: cc as Addr[], bcc: bcc as Addr[], subject, text: input.text ?? "", html: input.html, parentId: input.parentId ?? null, mode: input.mode ?? "new" });
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

/** Sign out of B Mail (and the other BuPulse client services that share the sign-in). */
export async function signOutMail(): Promise<void> {
  const { createClient } = await import("@/lib/supabase/server");
  const { redirect } = await import("next/navigation");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/mail/sign-in");
}

export type ProfileState = { ok?: string; error?: string };

/** The person's own profile and look: name, job title, mobile, extra signature line, background. */
export async function saveProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const me = await requireMail();
  const { toE164 } = await import("@/lib/phone");
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  if (!name) return { error: "Enter your name." };
  const title = String(form.get("title") ?? "").trim().slice(0, 120) || null;
  const rawPhone = String(form.get("phone") ?? "").trim();
  const phone = rawPhone ? toE164(rawPhone, "RW") : null;
  if (rawPhone && !phone) return { error: "That phone number does not look right." };
  const extra = String(form.get("signatureExtra") ?? "").trim().slice(0, 120);
  const background = ["kigali-hills", "kigali-night", "kivu-beach", "virunga", "plain"].includes(String(form.get("background"))) ? String(form.get("background")) : "kigali-hills";
  const prefs = { ...me.prefs, signatureExtra: extra, background };
  if (me.memberId) {
    await prisma.mailMember.update({ where: { id: me.memberId }, data: { name, title, phone, prefs } });
  } else {
    // The owner (ADMIN_EMAILS) has no member row until they save a profile: it is made as a super admin.
    await prisma.mailMember.create({ data: { email: me.email, name, title, phone, prefs, role: "owner", status: "active", userId: me.userId, createdBy: me.email } });
  }
  revalidatePath("/mail");
  return { ok: "Saved." };
}
