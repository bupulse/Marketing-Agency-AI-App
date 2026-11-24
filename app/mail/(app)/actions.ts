"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseAddressList, type Addr } from "@/lib/mail/addresses";
import { addressBook } from "@/lib/mail/address-book";
import type { ComposeAttachment, ComposeInit, ComposeMode, DraftMeta } from "@/lib/mail/draft-rules";
import { discardDraft, finishAttachment, loadDraft, removeAttachment, saveDraft, startAttachment, type SaveDraftResult, type UploadSlot } from "@/lib/mail/drafts";
import { isDeptToken, splitTokens } from "@/lib/mail/personal";
import { sanitizeComposerHtml } from "@/lib/mail/sanitize";
import type { AddressBook } from "@/lib/mail/suggest";
import { actOnThreads, type ThreadAction } from "@/lib/mail/queries";
import { deliverDue, queueMessage, undoSend, UNDO_SECONDS } from "@/lib/mail/send";
import { requireMail } from "@/lib/mail/session";
import { rateLimit } from "@/lib/rate-limit";

// B Mail's server actions. Each one checks the person again (requireMail): server actions are public POST endpoints.

/** What the composer sends and saves. To holds addresses and department chips ("dept:<id>"). */
export type SendInput = { draftId?: string | null; from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; html?: string; parentId?: string | null; mode?: ComposeMode };
export type SendState = { ok: true; messageId: string; threadId: string; undoSeconds: number; count: number } | { ok: false; error: string };

const MODES: readonly ComposeMode[] = ["new", "reply", "all", "forward"];
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 300) : []);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const mode = (v: unknown): ComposeMode => (MODES.includes(v as ComposeMode) ? (v as ComposeMode) : "new");

const list = (raw: string[], field: string): Addr[] | string => {
  const { list: l, invalid } = parseAddressList(raw.join(", "));
  return invalid.length ? `${field}: "${invalid[0]}" is not an email address.` : l;
};

export async function sendMailAction(input: SendInput): Promise<SendState> {
  const me = await requireMail();
  const { addresses, departments } = splitTokens(strings(input.to));
  const to = list(addresses, "To");
  const cc = list(strings(input.cc).filter((s) => !isDeptToken(s)), "Cc");
  const bcc = list(strings(input.bcc).filter((s) => !isDeptToken(s)), "Bcc");
  for (const x of [to, cc, bcc]) if (typeof x === "string") return { ok: false, error: x };
  const subject = str(input.subject, 500).trim() || "(no subject)";
  const html = str(input.html, 400_000);
  const composer: DraftMeta = { v: 1, to: strings(input.to), cc: strings(input.cc), bcc: strings(input.bcc), subject: str(input.subject, 500), body: sanitizeComposerHtml(html), parentId: typeof input.parentId === "string" ? input.parentId : null, mode: mode(input.mode), dropped: [] };
  const r = await queueMessage(me, {
    fromMailboxId: str(input.from, 100), to: to as Addr[], cc: cc as Addr[], bcc: bcc as Addr[], subject, text: str(input.text, 200_000), html,
    parentId: composer.parentId, mode: composer.mode, departments, draftId: typeof input.draftId === "string" ? input.draftId : null, composer,
  });
  if (!r.ok) return r;
  // Deliver right after the undo window, from this request; page loads and the cron route catch anything left.
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, UNDO_SECONDS * 1000 + 800));
    // A department send queues one email per person: keep going while full batches come back.
    for (let i = 0; i < Math.ceil(r.count / 20) + 1; i++) {
      const done = await deliverDue();
      if (done.sent + done.failed < 20) break;
    }
  });
  revalidatePath("/mail");
  return { ok: true, messageId: r.messageId, threadId: r.threadId, undoSeconds: UNDO_SECONDS, count: r.count };
}

/** Undo: the send stops and its draft comes back (the shell reopens it in the composer). */
export async function undoSendAction(messageId: string): Promise<{ ok: boolean; draftId: string | null }> {
  const me = await requireMail();
  const draftId = await undoSend(me, str(messageId, 100));
  revalidatePath("/mail");
  return { ok: !!draftId, draftId };
}

/** Autosave: creates the draft the first time, then keeps it up to date. */
export async function saveDraftAction(input: SendInput): Promise<SaveDraftResult> {
  const me = await requireMail();
  return saveDraft(me, {
    draftId: typeof input.draftId === "string" ? input.draftId : null, from: str(input.from, 100), to: strings(input.to), cc: strings(input.cc), bcc: strings(input.bcc),
    subject: str(input.subject, 500), html: str(input.html, 400_000), text: str(input.text, 200_000), parentId: typeof input.parentId === "string" ? input.parentId : null, mode: mode(input.mode),
  });
}

export async function loadDraftAction(draftId: string): Promise<ComposeInit | null> {
  const me = await requireMail();
  return loadDraft(me, str(draftId, 100));
}

export async function discardDraftAction(draftId: string): Promise<{ ok: boolean }> {
  const me = await requireMail();
  const ok = await discardDraft(me, str(draftId, 100));
  revalidatePath("/mail");
  return { ok };
}

/** Attaching, step 1: a one-time upload link (the file goes straight to the private mail bucket). */
export async function startAttachmentAction(draftId: string, file: { filename: string; size: number }): Promise<UploadSlot> {
  const me = await requireMail();
  try {
    await rateLimit(`mail-attach:${me.userId}`, { limit: 60, windowSeconds: 600 });
  } catch {
    return { ok: false, error: "Too many files at once. Wait a few minutes and try again." };
  }
  return startAttachment(me, str(draftId, 100), { filename: str(file?.filename, 300) || "file", size: Number(file?.size) || 0 });
}

/** Attaching, step 2: the upload is done; the server checks what arrived and adds it to the draft. */
export async function finishAttachmentAction(draftId: string, file: { path: string; filename: string; contentType: string }): Promise<{ ok: true; attachment: ComposeAttachment } | { ok: false; error: string }> {
  const me = await requireMail();
  return finishAttachment(me, str(draftId, 100), { path: str(file?.path, 400), filename: str(file?.filename, 300) || "file", contentType: str(file?.contentType, 120) });
}

export async function removeAttachmentAction(attachmentId: string): Promise<{ ok: boolean }> {
  const me = await requireMail();
  return { ok: await removeAttachment(me, str(attachmentId, 100)) };
}

/** Team members, shared mailboxes, departments this person may send to, and recent contacts, for suggestions. */
export async function addressBookAction(): Promise<AddressBook> {
  const me = await requireMail();
  return addressBook(me);
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

/** Changing the password from Settings (signed in with the authenticator code, so the session is AAL2). */
export async function changeMailPassword(_prev: { error?: string; ok?: string }, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const { mailPasswordProblem } = await import("@/lib/mail/temp-password");
  const { createClient } = await import("@/lib/supabase/server");
  const me = await requireMail();
  const password = String(formData.get("password") ?? "");
  const problem = mailPasswordProblem(password, String(formData.get("confirm") ?? ""));
  if (problem) return { error: problem };
  try {
    await rateLimit(`mail-change-password:${me.userId}`, { limit: 5, windowSeconds: 600 });
  } catch {
    return { error: "Too many tries. Wait a few minutes and try again." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { error: "That is already your password. Choose a new one." };
    if (error.code === "weak_password") return { error: "That password is too easy to guess. Try a longer one." };
    return { error: "Could not save the password. Please try again." };
  }
  return { ok: "Password changed. Use it next time you sign in with your password." };
}
