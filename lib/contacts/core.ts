import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { cleanText, normalizeEmail, normalizePhone } from "@/lib/leads/normalize";
import { fold } from "@/lib/automations/match";

// Contact changes shared by the automations engine, the inbox and the Contacts pages. Every function is scoped by
// businessId: a contact id from another business never matches.

export const MAX_TAGS_PER_BUSINESS = 200;
export const MAX_FIELDS_PER_BUSINESS = 50;

export class ContactError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "limit",
    message: string,
  ) {
    super(message);
    this.name = "ContactError";
  }
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** A field key from a label: "Delivery district" -> "delivery_district". */
export function fieldKeyOf(label: string): string {
  return fold(label).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
}

/** The tag with this name (any case), created when missing. */
export async function ensureTag(businessId: string, name: string): Promise<{ id: string; name: string }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) throw new ContactError("invalid", "A tag needs a name.");
  const existing = await prisma.contactTag.findFirst({ where: { businessId, name: { equals: clean, mode: "insensitive" } }, select: { id: true, name: true } });
  if (existing) return existing;
  const count = await prisma.contactTag.count({ where: { businessId } });
  if (count >= MAX_TAGS_PER_BUSINESS) throw new ContactError("limit", `You can have up to ${MAX_TAGS_PER_BUSINESS} tags. Delete one you no longer use.`);
  try {
    return await prisma.contactTag.create({ data: { businessId, name: clean }, select: { id: true, name: true } });
  } catch (error) {
    if (!isUnique(error)) throw error;
    return prisma.contactTag.findFirstOrThrow({ where: { businessId, name: clean }, select: { id: true, name: true } });
  }
}

async function ownContact(businessId: string, contactId: string) {
  const c = await prisma.contact.findFirst({ where: { id: contactId, businessId }, select: { id: true, fields: true } });
  if (!c) throw new ContactError("not_found", "That contact no longer exists.");
  return c;
}

export async function addTag(businessId: string, contactId: string, tagName: string): Promise<void> {
  await ownContact(businessId, contactId);
  const tag = await ensureTag(businessId, tagName);
  await prisma.contactTagLink.upsert({ where: { contactId_tagId: { contactId, tagId: tag.id } }, create: { contactId, tagId: tag.id }, update: {} });
}

export async function removeTag(businessId: string, contactId: string, tagName: string): Promise<void> {
  await ownContact(businessId, contactId);
  const tag = await prisma.contactTag.findFirst({ where: { businessId, name: { equals: tagName.trim(), mode: "insensitive" } }, select: { id: true } });
  if (tag) await prisma.contactTagLink.deleteMany({ where: { contactId, tagId: tag.id } });
}

export async function tagNames(contactId: string): Promise<string[]> {
  const links = await prisma.contactTagLink.findMany({ where: { contactId }, select: { tag: { select: { name: true } } } });
  return links.map((l) => l.tag.name);
}

export function readFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)]));
}

/** Sets one custom field (an empty value clears it). The field must exist for the business. */
export async function setField(businessId: string, contactId: string, key: string, value: string): Promise<void> {
  const contact = await ownContact(businessId, contactId);
  const field = await prisma.contactField.findUnique({ where: { businessId_key: { businessId, key } }, select: { key: true } });
  if (!field) throw new ContactError("not_found", "That contact field no longer exists.");
  const fields = readFields(contact.fields);
  const clean = value.trim().slice(0, 500);
  if (clean) fields[key] = clean;
  else delete fields[key];
  await prisma.contact.update({ where: { id: contactId }, data: { fields } });
}

/** Saves the name, email or phone the person gave (normalised). Invalid values are ignored; returns what changed. */
export async function saveDetails(businessId: string, contactId: string, details: { name?: string | null; email?: string | null; phone?: string | null }) {
  await ownContact(businessId, contactId);
  const data: { name?: string; email?: string; phone?: string } = {};
  const name = cleanText(details.name, 120);
  const email = normalizeEmail(details.email);
  const phone = normalizePhone(details.phone);
  if (name) data.name = name;
  if (email) data.email = email;
  if (phone) data.phone = phone;
  if (Object.keys(data).length) await prisma.contact.update({ where: { id: contactId }, data });
  return data;
}

/** The contact's data the engine needs for texts and conditions. */
export async function contactSnapshot(businessId: string, contactId: string) {
  const c = await prisma.contact.findFirst({
    where: { id: contactId, businessId },
    select: { id: true, name: true, email: true, phone: true, fields: true, emailOptIn: true, unsubscribedAt: true, tags: { select: { tag: { select: { name: true } } } } },
  });
  if (!c) return null;
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, fields: readFields(c.fields), tags: c.tags.map((t) => t.tag.name), emailOptIn: c.emailOptIn, unsubscribed: !!c.unsubscribedAt };
}
