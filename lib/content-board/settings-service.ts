// Content -> Settings on the server: read, and save by an Owner or Admin with an audit row (docs/CONTENT.md).
import "server-only";
import { writeAudit } from "@/lib/admin/audit";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { can, ForbiddenError, type Role } from "@/lib/team/roles";
import { autoApps, contentSettingsSchema, readContentSettings, type ContentSettings, type ContentSettingsInput } from "./settings";

export class ContentSettingsError extends Error {}

export async function getContentSettings(businessId: string): Promise<ContentSettings> {
  const row = await prisma.business.findUnique({ where: { id: businessId }, select: { contentSettings: true } });
  return readContentSettings(row?.contentSettings);
}

/**
 * Saves which apps need approval. Only Owners and Admins (`contentSettings`); the role is checked here, not only on
 * the page. The change and its audit row (actor = the person, target = the company) are written together.
 * Only new posts follow the new setting: posts already waiting stay where they are.
 */
export async function saveContentSettings(actor: { actorId: string; role: Role; businessId: string }, input: ContentSettingsInput): Promise<ContentSettings> {
  if (!can(actor.role, "contentSettings")) throw new ForbiddenError("contentSettings");
  const parsed = contentSettingsSchema.safeParse(input);
  if (!parsed.success) throw new ContentSettingsError("Check the settings and try again.");
  const next = readContentSettings(parsed.data);
  await prisma.$transaction(async (tx) => {
    const row = await tx.business.findUnique({ where: { id: actor.businessId }, select: { contentSettings: true } });
    if (!row) throw new ContentSettingsError("We could not find your business.");
    const before = readContentSettings(row.contentSettings);
    await tx.business.update({ where: { id: actor.businessId }, data: { contentSettings: next as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, { actor: `user:${actor.actorId}`, ip: null, viaApi: false }, "content.settings", `company:${actor.businessId}`, { autoApps: autoApps(before) }, { autoApps: autoApps(next) });
  });
  return next;
}
