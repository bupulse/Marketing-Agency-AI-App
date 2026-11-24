"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { cleanAddress, isOurAddress, MAIL_DOMAIN } from "@/lib/mail/addresses";
import { requireMailAdmin } from "@/lib/mail/session";
import { toE164 } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETUP_GRANT_KEY, setupGrantUntil, suggestPassword } from "@/lib/support/setup-grant";

// The Mail console (docs/MAIL_CRM.md "Mail console"): mail admins only. Every action checks again.

export type ConsoleState = { ok?: string; error?: string; password?: string };

const QUOTAS = [50, 100, 250, 500, 1000];

/**
 * Creates a person: their own mailbox (name@bupulse.com), a Mail member row, and a BuPulse login with a one-time
 * password to hand over. Their first sign-in asks them to add an authenticator (the one-time setup permission lets
 * them do it without an emailed code, since their new mailbox is still empty).
 */
export async function createMailUser(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const local = String(form.get("local") ?? "").trim().toLowerCase();
  const wanted = String(form.get("role"));
  const role = wanted === "owner" && me.isSuper ? "owner" : wanted === "admin" ? "admin" : "member";
  const departmentId = String(form.get("departmentId") ?? "") || null;
  const title = String(form.get("title") ?? "").trim().slice(0, 120) || null;
  const phone = toE164(String(form.get("phone") ?? ""), "RW");
  const quotaMb = QUOTAS.includes(Number(form.get("quotaMb"))) ? Number(form.get("quotaMb")) : 250;
  if (!name) return { error: "Enter the person's name." };
  if (!/^[a-z0-9]([a-z0-9._-]{0,40}[a-z0-9])?$/.test(local)) return { error: "Use letters, numbers, dots or dashes for the address (e.g. grace)." };
  const email = `${local}@${MAIL_DOMAIN}`;
  const existingBox = await prisma.mailbox.findUnique({ where: { address: email }, select: { id: true, kind: true, memberId: true } });
  // A named mailbox nobody owns yet (cyusa@ from the first setup) is given to this person; anything else is taken.
  if (existingBox && (existingBox.kind !== "personal" || existingBox.memberId)) return { error: `${email} is already taken.` };
  if (await prisma.mailMember.findUnique({ where: { email } })) return { error: `${email} already has B Mail. Use "New password" in the list instead.` };
  if (await prisma.mailAlias.findUnique({ where: { address: email } })) return { error: `${email} is already an extra address.` };

  const password = suggestPassword((n) => randomInt(n));
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name }, app_metadata: { [SETUP_GRANT_KEY]: setupGrantUntil() } });
  let userId = data.user?.id ?? null;
  if (error) {
    // The login may exist already (a BuPulse account with this address): keep it, and do not change its password.
    if (!/already|registered|exists/i.test(error.message)) {
      await logError(error, { source: "mail.console.create-user", level: "warn" });
      return { error: "Could not create the login. Please try again." };
    }
    userId = null;
  }
  const settings = await prisma.mailSettings.findUnique({ where: { id: "default" }, select: { defaultTemplate: true } });
  const member = await prisma.mailMember.create({
    data: { email, name, role, departmentId, title, phone, quotaMb, status: "invited", createdBy: me.email, userId, prefs: { signatureTemplate: settings?.defaultTemplate ?? "classic" } },
  });
  if (existingBox) await prisma.mailbox.update({ where: { id: existingBox.id }, data: { memberId: member.id, name } });
  else await prisma.mailbox.create({ data: { address: email, name, kind: "personal", memberId: member.id, sortOrder: 15 } });
  revalidatePath("/mail");
  return userId
    ? { ok: `${email} is ready. Give ${name.split(" ")[0]} this password once; they add an authenticator at the first sign-in on bupulse.com/mail.`, password }
    : { ok: `${email} is ready. This address already had a BuPulse login: they sign in with it.` };
}

export async function updateMailUser(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const id = String(form.get("id") ?? "");
  const data: Record<string, unknown> = {};
  const target = await prisma.mailMember.findUnique({ where: { id }, select: { role: true, email: true } });
  if (!target) return { error: "Not found." };
  // Only super admins change who is an admin or a super admin, and nobody demotes themselves by accident.
  if (form.has("role")) {
    if (!me.isSuper) return { error: "Only a super admin can change roles." };
    if (target.email === me.email) return { error: "You cannot change your own role." };
    const wanted = String(form.get("role"));
    data.role = wanted === "owner" ? "owner" : wanted === "admin" ? "admin" : "member";
  }
  if (target.role === "owner" && !me.isSuper) return { error: "Only a super admin can change a super admin." };
  if (form.has("departmentId")) data.departmentId = String(form.get("departmentId")) || null;
  if (form.has("quotaMb") && QUOTAS.includes(Number(form.get("quotaMb")))) data.quotaMb = Number(form.get("quotaMb"));
  if (form.has("status")) data.status = form.get("status") === "suspended" ? "suspended" : "active";
  await prisma.mailMember.update({ where: { id }, data });
  revalidatePath("/mail/console");
  return { ok: "Saved." };
}

/** Department heads: one per department. */
export async function setDepartmentHead(departmentId: string, memberId: string | null): Promise<void> {
  await requireMailAdmin();
  await prisma.mailDepartment.update({ where: { id: departmentId }, data: { headMemberId: memberId } });
  revalidatePath("/mail/console");
}

export async function addForwarder(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const source = cleanAddress(String(form.get("source") ?? ""));
  const target = cleanAddress(String(form.get("target") ?? ""));
  if (!source || !isOurAddress(source)) return { error: "The first address must be a @bupulse.com address." };
  if (!target) return { error: "Enter the address to forward to." };
  if (source === target) return { error: "An address cannot forward to itself." };
  const external = !isOurAddress(target);
  const confirmed = form.get("confirmed") === "on";
  await prisma.mailForwarder.upsert({
    where: { source_target: { source, target } },
    create: { source, target, external, keepCopy: form.get("keepCopy") !== "off", enabled: true, verifiedAt: external && confirmed ? new Date() : null, createdBy: me.email },
    update: { enabled: true, keepCopy: form.get("keepCopy") !== "off", ...(external && confirmed ? { verifiedAt: new Date() } : {}) },
  });
  revalidatePath("/mail/console");
  return { ok: external && !confirmed ? `Saved. ${target} must also be confirmed in Cloudflare (Email Routing, Destination addresses) before mail goes out to it.` : "Saved." };
}

export async function toggleForwarder(id: string, enabled: boolean): Promise<void> {
  await requireMailAdmin();
  await prisma.mailForwarder.update({ where: { id }, data: { enabled } });
  revalidatePath("/mail/console");
}

export async function removeForwarder(id: string): Promise<void> {
  await requireMailAdmin();
  await prisma.mailForwarder.delete({ where: { id } });
  revalidatePath("/mail/console");
}

const url = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? s.replace(/^https?:\/\//i, "").slice(0, 200) : null;
};

export async function saveCompany(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const phone = String(form.get("companyPhone") ?? "").trim();
  const companyPhone = phone ? toE164(phone, "RW") : null;
  if (phone && !companyPhone) return { error: "The company phone does not look right." };
  const ctaUrl = String(form.get("ctaUrl") ?? "").trim() || "https://bupulse.com/quote";
  if (!/^https:\/\/[^\s]+$/.test(ctaUrl)) return { error: "The button link must start with https://" };
  const data = {
    companyPhone,
    website: String(form.get("website") ?? "").trim().slice(0, 100) || "bupulse.com",
    address: String(form.get("address") ?? "").trim().slice(0, 160) || "Kigali, Rwanda",
    linkedinUrl: url(form.get("linkedinUrl")),
    instagramUrl: url(form.get("instagramUrl")),
    facebookUrl: url(form.get("facebookUrl")),
    ctaText: String(form.get("ctaText") ?? "").trim().slice(0, 60) || "Get your free BuPulse quote",
    ctaUrl,
    updatedBy: me.email,
  };
  await prisma.mailSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  revalidatePath("/mail");
  return { ok: "Saved. Every signature uses these details from now on." };
}

/**
 * A one-time password for a person (a super admin only): makes their BuPulse login when it does not exist yet, or
 * replaces its password. They add an authenticator at the next sign-in without an emailed code (7-day permission).
 */
export async function newMailPassword(memberId: string): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  if (!me.isSuper) return { error: "Only a super admin can do this." };
  const member = await prisma.mailMember.findUnique({ where: { id: memberId }, select: { email: true, name: true } });
  if (!member) return { error: "Not found." };
  const password = suggestPassword((n) => randomInt(n));
  const admin = createAdminClient();
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM auth.users WHERE lower(email) = ${member.email} LIMIT 1`;
  const grant = { [SETUP_GRANT_KEY]: setupGrantUntil() };
  if (rows[0]) {
    const { error } = await admin.auth.admin.updateUserById(rows[0].id, { password, app_metadata: grant });
    if (error) return { error: "Could not change the password. Please try again." };
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email: member.email, password, email_confirm: true, user_metadata: { full_name: member.name ?? "" }, app_metadata: grant });
    if (error || !data.user) return { error: "Could not create the login. Please try again." };
    await prisma.mailMember.update({ where: { id: memberId }, data: { userId: data.user.id } });
  }
  return { ok: `New one-time password for ${member.email}. Give it to them once; they sign in at bupulse.com/mail.`, password };
}
