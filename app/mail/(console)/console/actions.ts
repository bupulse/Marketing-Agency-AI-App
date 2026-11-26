"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { cleanAddress, isOurAddress, MAIL_DOMAIN } from "@/lib/mail/addresses";
import { addressProblem, bytesToMb, DEPT_COLORS, isHexColor, isQuota, LOCAL_PART, ourAddressFrom, senderPattern } from "@/lib/mail/console-rules";
import { requireMailAdmin } from "@/lib/mail/session";
import { createAgentKey, revokeAgentKey } from "@/lib/mail/agent";
import { parseDailyLimit } from "@/lib/mail/agent-rules";
import { isSignatureLook } from "@/lib/mail/signature-render";
import { toE164 } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETUP_GRANT_KEY, setupGrantUntil, suggestPassword } from "@/lib/support/setup-grant";
import { TEMP_PASSWORD_KEY } from "@/lib/mail/temp-password";

// The Mail console (docs/MAIL_CRM.md "Mail console"): mail admins only. Every action checks again.

export type ConsoleState = { ok?: string; error?: string; password?: string; email?: string; key?: string };

/** Every console page shows counts from the others (users per department, forwards per user): refresh them all. */
const refreshConsole = () => revalidatePath("/mail/console", "layout");

/** Who already has an address: named mailboxes, members and extra addresses. */
async function takenFor(address: string) {
  const [box, member, alias] = await Promise.all([
    prisma.mailbox.findUnique({ where: { address }, select: { id: true, kind: true, memberId: true } }),
    prisma.mailMember.findUnique({ where: { email: address }, select: { id: true } }),
    prisma.mailAlias.findUnique({ where: { address }, select: { id: true } }),
  ]);
  return {
    box,
    taken: { mailboxes: box ? [address] : [], members: member ? [address] : [], aliases: alias ? [address] : [] },
    unownedPersonal: box && box.kind === "personal" && !box.memberId ? [address] : [],
  };
}

/** The live "address is free" check on Create user. */
export async function checkMailAddress(local: string): Promise<{ address: string | null; free: boolean; message: string }> {
  await requireMailAdmin();
  const clean = local.trim().toLowerCase();
  if (!clean) return { address: null, free: false, message: "" };
  if (!LOCAL_PART.test(clean)) return { address: null, free: false, message: "Use letters, numbers, dots or dashes (e.g. grace)." };
  const address = `${clean}@${MAIL_DOMAIN}`;
  const t = await takenFor(address);
  const problem = addressProblem(address, t.taken, { unownedPersonal: t.unownedPersonal });
  return { address, free: !problem, message: problem ?? `${address} is free` };
}

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
  const quotaMb = isQuota(Number(form.get("quotaMb"))) ? Number(form.get("quotaMb")) : 250;
  const makeHead = form.get("head") === "on";
  const accessIds = form.getAll("access").map(String).filter(Boolean);
  if (!name) return { error: "Enter the person's name." };
  if (!LOCAL_PART.test(local)) return { error: "Use letters, numbers, dots or dashes for the address (e.g. grace)." };
  const email = `${local}@${MAIL_DOMAIN}`;
  const { box: existingBox, taken, unownedPersonal } = await takenFor(email);
  // A named mailbox nobody owns yet (cyusa@ from the first setup) is given to this person; anything else is taken.
  const problem = addressProblem(email, taken, { unownedPersonal });
  if (problem) return { error: taken.members.length ? `${problem} Use "New password" in the list instead.` : problem };
  if (departmentId && !(await prisma.mailDepartment.findUnique({ where: { id: departmentId }, select: { id: true } }))) return { error: "That department no longer exists." };

  const password = suggestPassword((n) => randomInt(n));
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name }, app_metadata: { [SETUP_GRANT_KEY]: setupGrantUntil(), [TEMP_PASSWORD_KEY]: true } });
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
  if (makeHead && departmentId) await prisma.mailDepartment.update({ where: { id: departmentId }, data: { headMemberId: member.id } });
  // Shared mailboxes ticked on the form (admins see every mailbox anyway). Personal mailboxes are never given this way.
  if (accessIds.length && role === "member") {
    const shared = await prisma.mailbox.findMany({ where: { id: { in: accessIds }, kind: { not: "personal" } }, select: { id: true } });
    if (shared.length) await prisma.mailboxAccess.createMany({ data: shared.map((b) => ({ mailboxId: b.id, memberId: member.id })), skipDuplicates: true });
  }
  revalidatePath("/mail");
  refreshConsole();
  return userId
    ? { ok: `${email} is ready. Give ${name.split(" ")[0]} this password once; at the first sign-in on bupulse.com/mail (Password tab) they choose their own password, then add an authenticator.`, password, email }
    : { ok: `${email} is ready. This address already had a BuPulse login: they sign in with it.`, email };
}

export async function updateMailUser(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const id = String(form.get("id") ?? "");
  const data: Record<string, unknown> = {};
  const target = await prisma.mailMember.findUnique({ where: { id }, select: { role: true, email: true, quotaMb: true } });
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
  if (form.has("quotaMb") && isQuota(Number(form.get("quotaMb")))) {
    const quotaMb = Number(form.get("quotaMb"));
    // Less space than they already use would lock their mailbox: refuse it.
    if (quotaMb < target.quotaMb) {
      const box = await prisma.mailbox.findUnique({ where: { memberId: id }, select: { id: true } });
      const used = box ? (await prisma.mailMessage.aggregate({ where: { mailboxId: box.id }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0 : 0;
      if (bytesToMb(used) > quotaMb) return { error: `${target.email} already uses more than ${quotaMb} MB.` };
    }
    data.quotaMb = quotaMb;
  }
  if (form.has("status")) data.status = form.get("status") === "suspended" ? "suspended" : "active";
  await prisma.mailMember.update({ where: { id }, data });
  refreshConsole();
  return { ok: "Saved." };
}

/** Department heads: one per department. */
export async function setDepartmentHead(departmentId: string, memberId: string | null): Promise<void> {
  await requireMailAdmin();
  await prisma.mailDepartment.update({ where: { id: departmentId }, data: { headMemberId: memberId } });
  refreshConsole();
}

/**
 * Puts a person in a department (or in none) from the department page's drag and drop. One department per person, so
 * this moves them out of their old one; if they were its head, that department has no head until one is picked.
 */
export async function setMemberDepartment(memberId: string, departmentId: string | null): Promise<ConsoleState & { from?: string | null }> {
  const me = await requireMailAdmin();
  const target = await prisma.mailMember.findUnique({ where: { id: memberId }, select: { role: true, departmentId: true, name: true, email: true } });
  if (!target) return { error: "That person is no longer here. Reload the page." };
  if (target.role === "owner" && !me.isSuper) return { error: "Only a super admin can change a super admin." };
  if (departmentId && !(await prisma.mailDepartment.findUnique({ where: { id: departmentId }, select: { id: true } }))) return { error: "That department was deleted. Reload the page." };
  if (target.departmentId === departmentId) return { ok: "Saved.", from: departmentId };
  await prisma.$transaction([
    ...(target.departmentId ? [prisma.mailDepartment.updateMany({ where: { id: target.departmentId, headMemberId: memberId }, data: { headMemberId: null } })] : []),
    prisma.mailMember.update({ where: { id: memberId }, data: { departmentId } }),
  ]);
  revalidatePath("/mail");
  refreshConsole();
  return { ok: "Saved.", from: target.departmentId };
}

const deptName = (v: FormDataEntryValue | string | null) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 40);

export async function createDepartment(nameIn: string, colorIn?: string): Promise<ConsoleState & { id?: string; name?: string; color?: string }> {
  await requireMailAdmin();
  const name = deptName(nameIn);
  if (!name) return { error: "Enter a name for the department." };
  const existing = await prisma.mailDepartment.findMany({ select: { name: true, sortOrder: true } });
  if (existing.some((d) => d.name.toLowerCase() === name.toLowerCase())) return { error: `There is already a department called ${name}.` };
  const color = colorIn && isHexColor(colorIn) ? colorIn.toLowerCase() : DEPT_COLORS[existing.length % DEPT_COLORS.length];
  const d = await prisma.mailDepartment.create({ data: { name, color, sortOrder: Math.max(0, ...existing.map((x) => x.sortOrder)) + 1 } });
  refreshConsole();
  return { ok: `${name} is ready.`, id: d.id, name: d.name, color: d.color };
}

/** Rename and/or recolour a department. */
export async function updateDepartment(id: string, patch: { name?: string; color?: string }): Promise<ConsoleState> {
  await requireMailAdmin();
  const data: { name?: string; color?: string } = {};
  if (patch.name !== undefined) {
    const name = deptName(patch.name);
    if (!name) return { error: "Enter a name for the department." };
    const clash = await prisma.mailDepartment.findFirst({ where: { name: { equals: name, mode: "insensitive" }, id: { not: id } }, select: { id: true } });
    if (clash) return { error: `There is already a department called ${name}.` };
    data.name = name;
  }
  if (patch.color !== undefined) {
    if (!isHexColor(patch.color)) return { error: "Pick one of the colours." };
    data.color = patch.color.toLowerCase();
  }
  await prisma.mailDepartment.update({ where: { id }, data });
  refreshConsole();
  return { ok: "Saved." };
}

/**
 * Deletes a department. With people still in it, only when the admin chose to move them to no department. Its shared
 * mailbox (if any) stays, seen by admins and the people given it one by one.
 */
export async function deleteDepartment(id: string, movePeople: boolean): Promise<ConsoleState> {
  await requireMailAdmin();
  const count = await prisma.mailMember.count({ where: { departmentId: id } });
  if (count && !movePeople) return { error: `This department still has ${count === 1 ? "1 person" : `${count} people`}. Move them to no department first.` };
  await prisma.$transaction([
    prisma.mailMember.updateMany({ where: { departmentId: id }, data: { departmentId: null } }),
    prisma.mailbox.updateMany({ where: { departmentId: id, visibility: "department" }, data: { departmentId: null, visibility: "members" } }),
    prisma.mailbox.updateMany({ where: { departmentId: id }, data: { departmentId: null } }),
    prisma.mailDepartment.delete({ where: { id } }),
  ]);
  revalidatePath("/mail");
  refreshConsole();
  return { ok: "Deleted." };
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
  // The checkbox "Keep it in their inbox too": a checkbox sends nothing when it is off.
  const keepCopy = form.get("keepCopy") === "on";
  await prisma.mailForwarder.upsert({
    where: { source_target: { source, target } },
    create: { source, target, external, keepCopy, enabled: true, verifiedAt: external && confirmed ? new Date() : null, createdBy: me.email },
    update: { enabled: true, keepCopy, ...(external && confirmed ? { verifiedAt: new Date() } : {}) },
  });
  refreshConsole();
  return { ok: external && !confirmed ? `Saved. ${target} must also be confirmed in Cloudflare (Email Routing, Destination addresses) before mail goes out to it.` : "Saved." };
}

export async function toggleForwarder(id: string, enabled: boolean): Promise<void> {
  await requireMailAdmin();
  await prisma.mailForwarder.update({ where: { id }, data: { enabled } });
  refreshConsole();
}

export async function setForwarderKeepCopy(id: string, keepCopy: boolean): Promise<void> {
  await requireMailAdmin();
  await prisma.mailForwarder.update({ where: { id }, data: { keepCopy } });
  refreshConsole();
}

export async function removeForwarder(id: string): Promise<void> {
  await requireMailAdmin();
  await prisma.mailForwarder.delete({ where: { id } });
  refreshConsole();
}

/** Extra addresses (info@ into support@): land in an existing mailbox, no new user. Must be ours and free. */
export async function addAlias(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const address = ourAddressFrom(String(form.get("address") ?? ""));
  if (!address) return { error: "Use a @bupulse.com address (letters, numbers, dots or dashes before the @)." };
  const mailboxId = String(form.get("mailboxId") ?? "");
  const box = await prisma.mailbox.findUnique({ where: { id: mailboxId }, select: { id: true, address: true } });
  if (!box?.address) return { error: "Pick the mailbox it lands in." };
  const t = await takenFor(address);
  const problem = addressProblem(address, t.taken);
  if (problem) return { error: problem };
  await prisma.mailAlias.create({ data: { address, mailboxId: box.id, createdBy: me.email } });
  refreshConsole();
  return { ok: `Mail to ${address} now lands in ${box.address}.` };
}

export async function removeAlias(id: string): Promise<void> {
  await requireMailAdmin();
  await prisma.mailAlias.delete({ where: { id } });
  refreshConsole();
}

/** Spam and blocks: an address or a whole domain always goes to Spam ("spam") or never does ("allow"). */
export async function addSenderRule(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const pattern = senderPattern(String(form.get("pattern") ?? ""));
  if (!pattern) return { error: "Enter an address (name@example.com) or a domain (@example.com)." };
  if (pattern === `@${MAIL_DOMAIN}` || (!pattern.startsWith("@") && isOurAddress(pattern))) return { error: "Rules are for outside senders: our own addresses cannot be blocked or allowed." };
  const action = form.get("action") === "allow" ? "allow" : "spam";
  await prisma.mailSenderRule.upsert({ where: { pattern }, create: { pattern, action, createdBy: me.email }, update: { action } });
  refreshConsole();
  return { ok: action === "spam" ? `Mail from ${pattern} now goes to Spam.` : `Mail from ${pattern} never goes to Spam.` };
}

export async function removeSenderRule(id: string): Promise<void> {
  await requireMailAdmin();
  await prisma.mailSenderRule.delete({ where: { id } });
  refreshConsole();
}

const url = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? s.replace(/^https?:\/\//i, "").slice(0, 200) : null;
};

const TINTS = ["light", "dark", "blue"];

export async function saveCompany(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const phone = String(form.get("companyPhone") ?? "").trim();
  const companyPhone = phone ? toE164(phone, "RW") : null;
  if (phone && !companyPhone) return { error: "The company phone does not look right." };
  const ctaUrl = String(form.get("ctaUrl") ?? "").trim() || "https://bupulse.com/quote";
  if (!/^https:\/\/[^\s]+$/.test(ctaUrl)) return { error: "The button link must start with https://" };
  const data: Record<string, unknown> = {
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
  // Look for the whole team (Company and look): sent by that page only.
  if (form.has("glassClarity")) {
    const clarity = Math.round(Number(form.get("glassClarity")) / 5) * 5;
    data.glassClarity = Number.isFinite(clarity) ? Math.min(100, Math.max(0, clarity)) : 60;
    const tint = String(form.get("glassTint") ?? "light");
    data.glassTint = TINTS.includes(tint) ? tint : "light";
    data.usersChangeGlass = form.get("usersChangeGlass") === "on";
  }
  if (form.has("defaultTemplate")) {
    const look = String(form.get("defaultTemplate"));
    if (isSignatureLook(look)) data.defaultTemplate = look;
  }
  await prisma.mailSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  revalidatePath("/mail", "layout");
  return { ok: "Saved. Every signature uses these details from now on." };
}

/** Gives every user the default signature look (their own lines stay as they are). */
export async function applyDefaultLookToAll(): Promise<ConsoleState> {
  await requireMailAdmin();
  const settings = await prisma.mailSettings.findUnique({ where: { id: "default" }, select: { defaultTemplate: true } });
  const look = isSignatureLook(settings?.defaultTemplate) ? settings!.defaultTemplate : "classic";
  const members = await prisma.mailMember.findMany({ select: { id: true, prefs: true } });
  for (const m of members) {
    const prefs = (m.prefs as Record<string, unknown> | null) ?? {};
    if (prefs.signatureTemplate !== look) await prisma.mailMember.update({ where: { id: m.id }, data: { prefs: { ...prefs, signatureTemplate: look } } });
  }
  revalidatePath("/mail", "layout");
  return { ok: `All ${members.length} users now have the ${look[0].toUpperCase()}${look.slice(1)} look.` };
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
  const grant = { [SETUP_GRANT_KEY]: setupGrantUntil(), [TEMP_PASSWORD_KEY]: true };
  if (rows[0]) {
    const { error } = await admin.auth.admin.updateUserById(rows[0].id, { password, app_metadata: grant });
    if (error) return { error: "Could not change the password. Please try again." };
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email: member.email, password, email_confirm: true, user_metadata: { full_name: member.name ?? "" }, app_metadata: grant });
    if (error || !data.user) return { error: "Could not create the login. Please try again." };
    await prisma.mailMember.update({ where: { id: memberId }, data: { userId: data.user.id } });
  }
  return { ok: `New one-time password for ${member.email}. Give it to them once: they sign in at bupulse.com/mail (Password tab) and choose their own.`, password };
}

/**
 * A lost phone: removes the person's authenticator so they add a new one at the next sign-in (with the 7-day
 * permission instead of an emailed code). Mail admins may do it for members; only a super admin for an admin or a
 * super admin. Nobody resets their own (that would let a stolen session drop the second step).
 */
export async function resetMailAuthenticator(memberId: string): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const member = await prisma.mailMember.findUnique({ where: { id: memberId }, select: { email: true, role: true } });
  if (!member) return { error: "Not found." };
  if (member.email === me.email) return { error: "You cannot reset your own authenticator. Ask another admin." };
  if (member.role !== "member" && !me.isSuper) return { error: "Only a super admin can reset an admin's authenticator." };
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM auth.users WHERE lower(email) = ${member.email} LIMIT 1`;
  if (!rows[0]) return { error: "This person has no login yet. Use New password." };
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: rows[0].id });
  if (error) return { error: "Could not reach the sign-in service. Please try again." };
  for (const f of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId: rows[0].id, id: f.id });
  await admin.auth.admin.updateUserById(rows[0].id, { app_metadata: { [SETUP_GRANT_KEY]: setupGrantUntil() } });
  return { ok: `${member.email} adds a new authenticator at the next sign-in (within 7 days).` };
}

// ---- Agent keys (docs/mail-crm/AGENT_API.md): an outreach agent sends from one mailbox and reads what arrives ----

/** Makes an agent key. The key is in the answer once (state.key) and never again: only its hash is stored. */
export async function createAgentKeyAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const me = await requireMailAdmin();
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Give the key a name, for example \"Sellbird\"." };
  if (name.length > 60) return { error: "That name is too long." };
  const dailyLimit = parseDailyLimit(form.get("dailyLimit"));
  if (dailyLimit === null) return { error: "Daily sends must be a whole number from 1 to 100." };
  const fromName = String(form.get("fromName") ?? "").replace(/[\r\n<>"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const r = await createAgentKey({
    name,
    mailboxId: String(form.get("mailboxId") ?? ""),
    dailyLimit,
    fromName,
    signature: form.get("signature") === "on",
    memberId: me.memberId,
    createdBy: me.email,
  });
  if (!r.ok) return { error: r.error };
  refreshConsole();
  return { ok: "Key made. Copy it now: it is shown only once.", key: r.key };
}

export async function revokeAgentKeyAction(id: string): Promise<void> {
  await requireMailAdmin();
  await revokeAgentKey(id);
  refreshConsole();
}
