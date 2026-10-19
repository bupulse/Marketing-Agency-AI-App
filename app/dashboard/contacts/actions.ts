"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import { ForbiddenError, type Permission } from "@/lib/team/roles";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { ContactError } from "@/lib/contacts/core";
import { FIELD_TYPES, createField, deleteContacts, deleteField, deleteTag, importCsv, mergeContacts, renameTag, tagContacts, updateContact } from "@/lib/contacts/service";

export type ContactActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/** Editing contacts follows `content` (Members work leads too); deleting, importing, merging and fields need `settings`. */
async function member(permission: Permission = "content", { gated = true } = {}) {
  const user = await requireActiveUser(permission, "throw");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) throw new ContactError("not_found", "Finish setting up your business first.");
  if (gated) await assertFeature(business.id, "inbox");
  return { actorId: user.actorId, businessId: business.id };
}

async function guarded<T extends object>(run: () => Promise<T>): Promise<ContactActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    if (error instanceof Error && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    if (error instanceof ForbiddenError || error instanceof FeatureRequiredError || error instanceof ContactError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "Some details are not valid. Check them and try again." };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    console.error("[contacts.actions]", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC };
  }
}

const id = z.string().min(1).max(60);
const ids = z.array(id).min(1).max(500);

const detailsSchema = z.object({
  name: z.string().max(120),
  email: z.string().max(200),
  phone: z.string().max(40),
  emailOptIn: z.boolean(),
  fields: z.record(z.string().max(40), z.string().max(500)),
});

export async function saveContact(contactId: string, input: z.infer<typeof detailsSchema>) {
  return guarded(async () => {
    const { businessId } = await member();
    await updateContact(businessId, id.parse(contactId), detailsSchema.parse(input));
    revalidatePath(`/dashboard/contacts/${contactId}`);
    return {};
  });
}

export async function bulkTag(contactIds: string[], tag: string, add: boolean) {
  return guarded(async () => {
    const { businessId } = await member();
    const changed = await tagContacts(businessId, ids.parse(contactIds), z.string().trim().min(1).max(40).parse(tag), add);
    revalidatePath("/dashboard/contacts");
    return { changed };
  });
}

/** Deleting is never gated by the plan (the contacts are the company's own data). */
export async function removeContacts(contactIds: string[]) {
  return guarded(async () => {
    const { businessId } = await member("settings", { gated: false });
    const deleted = await deleteContacts(businessId, ids.parse(contactIds));
    revalidatePath("/dashboard/contacts");
    return { deleted };
  });
}

export async function merge(primaryId: string, secondaryId: string) {
  return guarded(async () => {
    const { businessId } = await member("settings");
    await mergeContacts(businessId, id.parse(primaryId), id.parse(secondaryId));
    revalidatePath("/dashboard/contacts");
    return {};
  });
}

export async function importContacts(csv: string) {
  return guarded(async () => {
    const { businessId, actorId } = await member("settings");
    await rateLimit(`contacts:import:${actorId}`, { limit: 10, windowSeconds: 3600 });
    const result = await importCsv(businessId, z.string().max(2_000_000).parse(csv));
    revalidatePath("/dashboard/contacts");
    return result;
  });
}

export async function addField(label: string, type: string, options: string[]) {
  return guarded(async () => {
    const { businessId } = await member("settings");
    const field = await createField(businessId, { label: z.string().max(60).parse(label), type: z.enum(FIELD_TYPES).parse(type), options: z.array(z.string().max(40)).max(30).parse(options) });
    revalidatePath("/dashboard/contacts");
    return { field };
  });
}

export async function removeField(fieldId: string) {
  return guarded(async () => {
    const { businessId } = await member("settings");
    await deleteField(businessId, id.parse(fieldId));
    revalidatePath("/dashboard/contacts");
    return {};
  });
}

export async function changeTag(tagId: string, name: string | null) {
  return guarded(async () => {
    const { businessId } = await member("settings");
    if (name === null) await deleteTag(businessId, id.parse(tagId));
    else await renameTag(businessId, id.parse(tagId), z.string().max(40).parse(name));
    revalidatePath("/dashboard/contacts");
    return {};
  });
}
