// Daily posts settings on the server (Content -> Settings, docs/CONTENT.md "Daily posts"): read, and save by an Owner
// or Admin with an audit row in the same transaction, like the approval settings (lib/content-board/settings-service.ts).
import "server-only";
import { writeAudit } from "@/lib/admin/audit";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getUsageSummary } from "@/lib/usage";
import { dailyPostAppsLimit, postsPerAppLimit } from "@/lib/plans";
import { can, ForbiddenError, type Role } from "@/lib/team/roles";
import { appsText, dailySettingsSchema, readDailySettings, type DailyPostSettings, type DailySettingsInput } from "./settings";

export class DailySettingsError extends Error {}

export async function getDailySettings(businessId: string): Promise<DailyPostSettings> {
  const row = await prisma.business.findUnique({ where: { id: businessId }, select: { dailyPostSettings: true } });
  return readDailySettings(row?.dailyPostSettings);
}

/**
 * Saves the daily posts choices. Only Owners and Admins (`contentSettings`, checked here, not only on the page); posts
 * per app may not pass the plan's posts per app per day, nor the chosen apps the plan's apps a day (Starter: 1). Changes
 * apply from the next day's posts.
 */
export async function saveDailySettings(actor: { actorId: string; role: Role; businessId: string; ownerId: string }, input: DailySettingsInput): Promise<DailyPostSettings> {
  if (!can(actor.role, "contentSettings")) throw new ForbiddenError("contentSettings");
  const parsed = dailySettingsSchema.safeParse(input);
  if (!parsed.success) throw new DailySettingsError(parsed.error.issues[0]?.message ?? "Check the settings and try again.");
  const limits = (await getUsageSummary(actor.ownerId).catch(() => null))?.limits;
  const limit = postsPerAppLimit(limits);
  if (parsed.data.perApp > limit) throw new DailySettingsError(`Your plan allows ${limit} ${limit === 1 ? "post" : "posts"} per app a day.`);
  const maxApps = dailyPostAppsLimit(limits);
  if (maxApps && parsed.data.apps && parsed.data.apps.length > maxApps) throw new DailySettingsError(`Your plan makes daily posts for ${appsText(maxApps)} a day. Choose ${maxApps === 1 ? "one app" : `up to ${maxApps}`}.`);
  const next = readDailySettings(parsed.data);
  await prisma.$transaction(async (tx) => {
    const row = await tx.business.findUnique({ where: { id: actor.businessId }, select: { dailyPostSettings: true } });
    if (!row) throw new DailySettingsError("We could not find your business.");
    const before = readDailySettings(row.dailyPostSettings);
    await tx.business.update({ where: { id: actor.businessId }, data: { dailyPostSettings: next as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, { actor: `user:${actor.actorId}`, ip: null, viaApi: false }, "content.daily_posts", `company:${actor.businessId}`, { ...before }, { ...next });
  });
  return next;
}
