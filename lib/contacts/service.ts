import "server-only";
import { prisma } from "@/lib/db";
import type { ChannelKind, Prisma } from "@/lib/generated/prisma/client";
import { cleanText, normalizeEmail, normalizePhone } from "@/lib/leads/normalize";
import { displayName } from "@/lib/inbox/service";
import { ContactError, MAX_FIELDS_PER_BUSINESS, ensureTag, fieldKeyOf, readFields } from "./core";
import { parseCsv } from "./csv-parse";

// The Contacts pages (app/dashboard/contacts): every person a business talks to, on any channel, with tags, custom
// fields, their conversations and leads. Scoped by businessId everywhere. docs/INBOX.md.

export const PAGE_SIZE = 50;
export const MAX_IMPORT_ROWS = 5000;
export const FIELD_TYPES = ["text", "number", "date", "choice", "yes_no"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type ContactFilters = { q?: string | null; tag?: string | null; channel?: ChannelKind | null };

function whereFor(businessId: string, f: ContactFilters): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { businessId, mergedIntoId: null };
  const q = f.q?.trim();
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { identities: { some: { handle: { contains: q, mode: "insensitive" } } } }];
  if (f.tag) where.tags = { some: { tag: { businessId, name: { equals: f.tag, mode: "insensitive" } } } };
  if (f.channel) where.identities = { some: { channel: f.channel } };
  return where;
}

export async function listContacts(businessId: string, filters: ContactFilters, limit = PAGE_SIZE) {
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where: whereFor(businessId, filters),
      orderBy: { lastSeenAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        lastSeenAt: true,
        lastChannel: true,
        identities: { select: { channel: true, handle: true, displayName: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    }),
    prisma.contact.count({ where: whereFor(businessId, filters) }),
  ]);
  return {
    total,
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map((r) => ({
      id: r.id,
      name: displayName(r.name, r.identities[0]),
      email: r.email,
      phone: r.phone,
      channels: [...new Set(r.identities.map((i) => i.channel))],
      tags: r.tags.map((t) => t.tag.name),
      lastSeenAt: r.lastSeenAt.toISOString(),
    })),
  };
}
export type ContactRow = Awaited<ReturnType<typeof listContacts>>["items"][number];

export async function getContact(businessId: string, contactId: string) {
  const c = await prisma.contact.findFirst({
    where: { id: contactId, businessId, mergedIntoId: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      language: true,
      fields: true,
      emailOptIn: true,
      unsubscribedAt: true,
      createdAt: true,
      lastSeenAt: true,
      identities: { select: { channel: true, handle: true, displayName: true, createdAt: true } },
      tags: { select: { tag: { select: { name: true } } } },
      conversations: { orderBy: { lastMessageAt: "desc" }, take: 20, select: { id: true, channel: true, status: true, preview: true, lastMessageAt: true } },
      leads: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, interest: true, createdAt: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 10, select: { id: true, status: true, startedAt: true, automation: { select: { id: true, name: true } } } },
    },
  });
  if (!c) return null;
  return {
    id: c.id,
    name: c.name ?? "",
    title: displayName(c.name, c.identities[0]),
    email: c.email ?? "",
    phone: c.phone ?? "",
    language: c.language,
    fields: readFields(c.fields),
    emailOptIn: c.emailOptIn,
    unsubscribed: !!c.unsubscribedAt,
    createdAt: c.createdAt.toISOString(),
    lastSeenAt: c.lastSeenAt.toISOString(),
    identities: c.identities.map((i) => ({ channel: i.channel, handle: i.handle, displayName: i.displayName })),
    tags: c.tags.map((t) => t.tag.name),
    conversations: c.conversations.map((v) => ({ ...v, lastMessageAt: v.lastMessageAt.toISOString() })),
    leads: c.leads.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    runs: c.runs.map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt.toISOString(), automation: r.automation })),
  };
}
export type ContactDetail = NonNullable<Awaited<ReturnType<typeof getContact>>>;

/** Saves the editable details: name, email, phone, custom fields and email consent. */
export async function updateContact(businessId: string, contactId: string, input: { name?: string; email?: string; phone?: string; fields?: Record<string, string>; emailOptIn?: boolean }) {
  const existing = await prisma.contact.findFirst({ where: { id: contactId, businessId }, select: { id: true, fields: true } });
  if (!existing) throw new ContactError("not_found", "That contact no longer exists.");
  const email = input.email !== undefined ? (input.email.trim() ? normalizeEmail(input.email) : null) : undefined;
  if (input.email?.trim() && !email) throw new ContactError("invalid", "That email address does not look right.");
  const phone = input.phone !== undefined ? (input.phone.trim() ? normalizePhone(input.phone) : null) : undefined;
  if (input.phone?.trim() && !phone) throw new ContactError("invalid", "That phone number does not look right.");
  let fields: Record<string, string> | undefined;
  if (input.fields) {
    const known = new Set((await prisma.contactField.findMany({ where: { businessId }, select: { key: true } })).map((f) => f.key));
    fields = readFields(existing.fields);
    for (const [k, v] of Object.entries(input.fields)) {
      if (!known.has(k)) continue;
      const clean = String(v).trim().slice(0, 500);
      if (clean) fields[k] = clean;
      else delete fields[k];
    }
  }
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      ...(input.name !== undefined ? { name: cleanText(input.name, 120) ?? null } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(fields ? { fields } : {}),
      ...(input.emailOptIn !== undefined ? { emailOptIn: input.emailOptIn, ...(input.emailOptIn ? { unsubscribedAt: null } : {}) } : {}),
    },
  });
}

export async function deleteContacts(businessId: string, ids: string[]): Promise<number> {
  const { count } = await prisma.contact.deleteMany({ where: { businessId, id: { in: ids } } });
  return count;
}

/** Tags with how many contacts carry each. */
export async function listTags(businessId: string) {
  const rows = await prisma.contactTag.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { links: true } } } });
  return rows.map((r) => ({ id: r.id, name: r.name, count: r._count.links }));
}

/** Adds or removes a tag on several contacts at once. */
export async function tagContacts(businessId: string, ids: string[], tagName: string, add: boolean): Promise<number> {
  const contacts = await prisma.contact.findMany({ where: { businessId, id: { in: ids } }, select: { id: true } });
  if (!contacts.length) return 0;
  if (add) {
    const tag = await ensureTag(businessId, tagName);
    const { count } = await prisma.contactTagLink.createMany({ data: contacts.map((c) => ({ contactId: c.id, tagId: tag.id })), skipDuplicates: true });
    return count;
  }
  const tag = await prisma.contactTag.findFirst({ where: { businessId, name: { equals: tagName.trim(), mode: "insensitive" } }, select: { id: true } });
  if (!tag) return 0;
  const { count } = await prisma.contactTagLink.deleteMany({ where: { tagId: tag.id, contactId: { in: contacts.map((c) => c.id) } } });
  return count;
}

export async function renameTag(businessId: string, tagId: string, name: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) throw new ContactError("invalid", "A tag needs a name.");
  const clash = await prisma.contactTag.findFirst({ where: { businessId, name: { equals: clean, mode: "insensitive" }, NOT: { id: tagId } }, select: { id: true } });
  if (clash) throw new ContactError("invalid", "Another tag already has that name.");
  const { count } = await prisma.contactTag.updateMany({ where: { id: tagId, businessId }, data: { name: clean } });
  if (!count) throw new ContactError("not_found", "That tag no longer exists.");
}

export async function deleteTag(businessId: string, tagId: string): Promise<void> {
  await prisma.contactTag.deleteMany({ where: { id: tagId, businessId } });
}

export async function listFields(businessId: string) {
  return prisma.contactField.findMany({ where: { businessId }, orderBy: { createdAt: "asc" }, select: { id: true, key: true, label: true, type: true, options: true } });
}

export async function createField(businessId: string, input: { label: string; type: FieldType; options?: string[] }) {
  const label = input.label.trim().slice(0, 60);
  if (!label) throw new ContactError("invalid", "A field needs a name.");
  const count = await prisma.contactField.count({ where: { businessId } });
  if (count >= MAX_FIELDS_PER_BUSINESS) throw new ContactError("limit", `You can have up to ${MAX_FIELDS_PER_BUSINESS} fields.`);
  const base = fieldKeyOf(label);
  let key = base;
  for (let i = 2; await prisma.contactField.findUnique({ where: { businessId_key: { businessId, key } }, select: { id: true } }); i++) key = `${base}_${i}`;
  const options = input.type === "choice" ? [...new Set((input.options ?? []).map((o) => o.trim().slice(0, 40)).filter(Boolean))].slice(0, 30) : [];
  if (input.type === "choice" && options.length < 2) throw new ContactError("invalid", "A choice field needs at least two options.");
  return prisma.contactField.create({ data: { businessId, key, label, type: input.type, options }, select: { id: true, key: true, label: true, type: true, options: true } });
}

export async function deleteField(businessId: string, fieldId: string): Promise<void> {
  await prisma.contactField.deleteMany({ where: { id: fieldId, businessId } });
}

/**
 * Merges `secondaryId` into `primaryId`: identities, conversations, leads, runs and tags move over, missing details are
 * copied, and the secondary is hidden (kept for old links). Both must belong to the business.
 */
export async function mergeContacts(businessId: string, primaryId: string, secondaryId: string): Promise<void> {
  if (primaryId === secondaryId) throw new ContactError("invalid", "Choose two different contacts.");
  const [a, b] = await Promise.all([
    prisma.contact.findFirst({ where: { id: primaryId, businessId, mergedIntoId: null } }),
    prisma.contact.findFirst({ where: { id: secondaryId, businessId, mergedIntoId: null } }),
  ]);
  if (!a || !b) throw new ContactError("not_found", "One of these contacts no longer exists.");
  await prisma.$transaction(async (tx) => {
    await tx.contactIdentity.updateMany({ where: { contactId: b.id }, data: { contactId: a.id } });
    await tx.conversation.updateMany({ where: { contactId: b.id }, data: { contactId: a.id } });
    await tx.lead.updateMany({ where: { contactId: b.id }, data: { contactId: a.id } });
    await tx.automationRun.updateMany({ where: { contactId: b.id }, data: { contactId: a.id } });
    const links = await tx.contactTagLink.findMany({ where: { contactId: b.id }, select: { tagId: true } });
    if (links.length) await tx.contactTagLink.createMany({ data: links.map((l) => ({ contactId: a.id, tagId: l.tagId })), skipDuplicates: true });
    await tx.contactTagLink.deleteMany({ where: { contactId: b.id } });
    await tx.contact.update({
      where: { id: a.id },
      data: {
        name: a.name ?? b.name,
        email: a.email ?? b.email,
        phone: a.phone ?? b.phone,
        avatarUrl: a.avatarUrl ?? b.avatarUrl,
        language: a.language ?? b.language,
        fields: { ...readFields(b.fields), ...readFields(a.fields) },
        emailOptIn: a.emailOptIn || b.emailOptIn,
        lastSeenAt: a.lastSeenAt > b.lastSeenAt ? a.lastSeenAt : b.lastSeenAt,
      },
    });
    await tx.contact.update({ where: { id: b.id }, data: { mergedIntoId: a.id, email: null, phone: null } });
  });
}

/** CSV columns for export, and the ones import understands. */
export const CSV_COLUMNS = ["name", "email", "phone", "tags", "channels", "last_seen"] as const;

function csvCell(value: string): string {
  // Formula-looking cells are prefixed so spreadsheets never run them.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function exportCsv(businessId: string, filters: ContactFilters): Promise<string> {
  const fields = await listFields(businessId);
  const rows = await prisma.contact.findMany({
    where: whereFor(businessId, filters),
    orderBy: { lastSeenAt: "desc" },
    take: 10_000,
    select: { name: true, email: true, phone: true, fields: true, lastSeenAt: true, identities: { select: { channel: true } }, tags: { select: { tag: { select: { name: true } } } } },
  });
  const head = [...CSV_COLUMNS, ...fields.map((f) => f.key)];
  const lines = rows.map((r) => {
    const values = readFields(r.fields);
    return [r.name ?? "", r.email ?? "", r.phone ?? "", r.tags.map((t) => t.tag.name).join("; "), [...new Set(r.identities.map((i) => i.channel))].join("; "), r.lastSeenAt.toISOString(), ...fields.map((f) => values[f.key] ?? "")]
      .map(csvCell)
      .join(",");
  });
  return [head.join(","), ...lines].join("\r\n");
}

/**
 * Imports contacts from CSV (columns: name, email, phone, tags separated by ";", and any custom field key). A row with
 * an email or phone already known updates that contact; rows without either are skipped. Returns the counts.
 */
export async function importCsv(businessId: string, text: string): Promise<{ created: number; updated: number; skipped: number }> {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new ContactError("invalid", "The file has no contacts. The first row must name the columns (name, email, phone, tags).");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new ContactError("limit", `Import up to ${MAX_IMPORT_ROWS} contacts at a time.`);
  const head = rows[0].map((h) => fieldKeyOf(h));
  const col = (name: string) => head.indexOf(name);
  const [iName, iEmail, iPhone, iTags] = [col("name"), col("email"), col("phone"), col("tags")];
  if (iEmail < 0 && iPhone < 0) throw new ContactError("invalid", "The file needs an email or a phone column.");
  const fieldKeys = new Set((await listFields(businessId)).map((f) => f.key));
  const result = { created: 0, updated: 0, skipped: 0 };
  for (const r of rows.slice(1)) {
    const email = iEmail >= 0 ? normalizeEmail(r[iEmail]) : undefined;
    const phone = iPhone >= 0 ? normalizePhone(r[iPhone]) : undefined;
    if (!email && !phone) {
      result.skipped++;
      continue;
    }
    const name = iName >= 0 ? cleanText(r[iName], 120) : undefined;
    const values: Record<string, string> = {};
    head.forEach((h, i) => {
      if (fieldKeys.has(h) && r[i]?.trim()) values[h] = r[i].trim().slice(0, 500);
    });
    const existing = await prisma.contact.findFirst({ where: { businessId, mergedIntoId: null, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] }, select: { id: true, fields: true } });
    let id: string;
    if (existing) {
      await prisma.contact.update({ where: { id: existing.id }, data: { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}), fields: { ...readFields(existing.fields), ...values } } });
      id = existing.id;
      result.updated++;
    } else {
      id = (await prisma.contact.create({ data: { businessId, name: name ?? null, email: email ?? null, phone: phone ?? null, fields: values }, select: { id: true } })).id;
      result.created++;
    }
    const tags = iTags >= 0 ? (r[iTags] ?? "").split(/[;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 10) : [];
    for (const t of tags) {
      const tag = await ensureTag(businessId, t);
      await prisma.contactTagLink.upsert({ where: { contactId_tagId: { contactId: id, tagId: tag.id } }, create: { contactId: id, tagId: tag.id }, update: {} });
    }
  }
  return result;
}
