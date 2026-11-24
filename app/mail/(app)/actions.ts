"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseAddressList, type Addr } from "@/lib/mail/addresses";
import { actOnThreads, type ThreadAction } from "@/lib/mail/queries";
import { deliverDue, queueMessage, undoSend, UNDO_SECONDS } from "@/lib/mail/send";
import { requireMail } from "@/lib/mail/session";
import { rateLimit } from "@/lib/rate-limit";

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
  const { isMailBackground } = await import("@/lib/mail/backgrounds");
  const background = isMailBackground(form.get("background")) && form.get("background") !== "photo" ? String(form.get("background")) : typeof me.prefs.background === "string" ? me.prefs.background : "kigali-hills";
  const { isSignatureLook } = await import("@/lib/mail/signature-render");
  const look = form.get("signatureTemplate");
  const prefs = { ...me.prefs, signatureExtra: extra, background, ...(isSignatureLook(look) ? { signatureTemplate: look } : {}) };
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

/** Quick settings: background and glass, saved for this person (design "Main" quick settings panel). */
export async function setMailLook(look: { background?: string; glass?: number }): Promise<{ ok: boolean }> {
  const { isMailBackground } = await import("@/lib/mail/backgrounds");
  const me = await requireMail();
  const prefs: Record<string, unknown> = { ...me.prefs };
  if (look.background !== undefined) {
    if (!isMailBackground(look.background)) return { ok: false };
    if (look.background === "photo" && typeof me.prefs.backgroundPhoto !== "string") return { ok: false };
    prefs.background = look.background;
  }
  if (look.glass !== undefined) {
    const settings = await prisma.mailSettings.findUnique({ where: { id: "default" }, select: { usersChangeGlass: true } });
    if (settings && !settings.usersChangeGlass && !me.isAdmin) return { ok: false };
    prefs.glass = Math.max(0, Math.min(100, Math.round(Number(look.glass) || 0)));
  }
  if (me.memberId) await prisma.mailMember.update({ where: { id: me.memberId }, data: { prefs: prefs as object } });
  else await prisma.mailMember.create({ data: { email: me.email, name: me.name, prefs: prefs as object, role: "owner", status: "active", userId: me.userId, createdBy: me.email } });
  revalidatePath("/mail", "layout");
  return { ok: true };
}

/** The person's member row (the ADMIN_EMAILS owner gets one, as a super admin, the first time they save anything). */
async function ensureMember(me: Awaited<ReturnType<typeof requireMail>>): Promise<string> {
  if (me.memberId) return me.memberId;
  const row = await prisma.mailMember.upsert({ where: { email: me.email }, update: {}, create: { email: me.email, name: me.name, prefs: me.prefs as object, role: "owner", status: "active", userId: me.userId, createdBy: me.email } });
  return row.id;
}

async function mergePrefs(memberId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await prisma.mailMember.findUnique({ where: { id: memberId }, select: { prefs: true } });
  await prisma.mailMember.update({ where: { id: memberId }, data: { prefs: { ...((row?.prefs as Record<string, unknown> | null) ?? {}), ...patch } as object } });
}

export type PhotoState = { ok?: boolean; error?: string; url?: string | null };

/** Profile photo (design "Welcome" step 1, Settings > General): a small square JPEG made in the browser. */
export async function saveMailPhoto(form: FormData): Promise<PhotoState> {
  const { photoProblem, PROFILE_MAX_BYTES, photoUrl } = await import("@/lib/mail/photo");
  const { putObjectReplacing, removeObjects } = await import("@/lib/mail/storage");
  const me = await requireMail();
  const file = form.get("photo");
  if (!(file instanceof Blob)) return { error: "Choose a photo first." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = photoProblem(bytes, PROFILE_MAX_BYTES);
  if (problem) return { error: problem };
  const id = await ensureMember(me);
  const old = await prisma.mailMember.findUnique({ where: { id }, select: { photoPath: true } });
  const path = `photos/${id}-${Date.now()}.jpg`;
  await putObjectReplacing(path, bytes, "image/jpeg");
  await prisma.mailMember.update({ where: { id }, data: { photoPath: path } });
  if (old?.photoPath) await removeObjects([old.photoPath]).catch(() => undefined);
  revalidatePath("/mail", "layout");
  return { ok: true, url: photoUrl(id, path) };
}

export async function removeMailPhoto(): Promise<PhotoState> {
  const { removeObjects } = await import("@/lib/mail/storage");
  const me = await requireMail();
  if (!me.memberId) return { ok: true, url: null };
  const old = await prisma.mailMember.findUnique({ where: { id: me.memberId }, select: { photoPath: true } });
  await prisma.mailMember.update({ where: { id: me.memberId }, data: { photoPath: null } });
  if (old?.photoPath) await removeObjects([old.photoPath]).catch(() => undefined);
  revalidatePath("/mail", "layout");
  return { ok: true, url: null };
}

/** Own background photo (design "Settings": made smaller, about 300 KB, counts toward storage; only they see it). */
export async function saveBackgroundPhoto(form: FormData): Promise<PhotoState> {
  const { photoProblem, BACKGROUND_MAX_BYTES } = await import("@/lib/mail/photo");
  const { putObjectReplacing, removeObjects } = await import("@/lib/mail/storage");
  const me = await requireMail();
  const file = form.get("photo");
  if (!(file instanceof Blob)) return { error: "Choose a photo first." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = photoProblem(bytes, BACKGROUND_MAX_BYTES);
  if (problem) return { error: problem };
  const id = await ensureMember(me);
  const path = `backgrounds/${id}-${Date.now()}.jpg`;
  await putObjectReplacing(path, bytes, "image/jpeg");
  const old = typeof me.prefs.backgroundPhoto === "string" ? me.prefs.backgroundPhoto : null;
  await mergePrefs(id, { backgroundPhoto: path, backgroundPhotoBytes: bytes.length, background: "photo" });
  if (old) await removeObjects([old]).catch(() => undefined);
  revalidatePath("/mail", "layout");
  return { ok: true };
}

/** Small personal switches: photo in signature, signature look, finished the welcome steps. */
export async function setMailPref(key: "photoInSignature" | "signatureTemplate" | "welcomed", value: boolean | string): Promise<{ ok: boolean }> {
  const { isSignatureLook } = await import("@/lib/mail/signature-render");
  const me = await requireMail();
  if (key === "signatureTemplate" && !isSignatureLook(value)) return { ok: false };
  if (key !== "signatureTemplate" && typeof value !== "boolean") return { ok: false };
  await mergePrefs(await ensureMember(me), { [key]: value });
  revalidatePath("/mail", "layout");
  return { ok: true };
}
