// Where trending Instagram sounds come from (owner decisions, 13 November 2026), on top of lib/social/instagram-audio.ts:
// - each Facebook Login Instagram account's trending music, asked of Meta at most once a day and kept in an
//   AdminSetting row ("igAudio.trending:<ig user id>": { day, items });
// - the admin's own list, "Trending Instagram sounds this week" (Admin -> Music, AdminSetting "music.igTrendingSounds"),
//   used for the tip when no Meta data is there.
// The tip never uses another company's token: it reads the lists already kept (any account's, from the last 7 days).
import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/types";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { cleanTrendingTips, fetchTrendingAudio, parseAudio, tipsFromAudio, type IgAudio, type TrendingTip } from "./instagram-audio";

export const ADMIN_TRENDING_KEY = "music.igTrendingSounds";
const CACHE_PREFIX = "igAudio.trending:";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const json = (value: unknown) => value as Prisma.InputJsonValue;

type Cached = { day: string; items: IgAudio[] };

function readCached(value: unknown): Cached | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { day?: unknown; items?: unknown };
  if (typeof v.day !== "string" || !Array.isArray(v.items)) return null;
  return { day: v.day, items: v.items.map(parseAudio).filter((a): a is IgAudio => !!a) };
}

/**
 * This account's trending music for today: from the day's cache, else asked of Meta and kept. On Meta's refusal the
 * last list kept is used (any day), else an empty list. Never throws.
 */
export async function trendingAudioFor(account: { externalAccountId: string; accessToken: string }, now = new Date()): Promise<IgAudio[]> {
  const key = `${CACHE_PREFIX}${account.externalAccountId}`;
  const row = await prisma.adminSetting.findUnique({ where: { key } }).catch(() => null);
  const cached = readCached(row?.value);
  if (cached && cached.day === utcDay(now)) return cached.items;
  try {
    const items = (await fetchTrendingAudio(account.accessToken, account.externalAccountId)).slice(0, 20);
    if (items.length) {
      const value = json({ day: utcDay(now), items });
      await prisma.adminSetting.upsert({ where: { key }, create: { key, value }, update: { value } }).catch(() => undefined);
    }
    return items.length ? items : (cached?.items ?? []);
  } catch (error) {
    await logError(error, { source: "instagram.audio.trending", level: "warn" }).catch(() => undefined);
    return cached?.items ?? [];
  }
}

/** The admin's "Trending Instagram sounds this week" list (empty when none was saved). */
export async function adminTrendingTips(): Promise<{ tips: TrendingTip[]; updatedAt: Date | null }> {
  const row = await prisma.adminSetting.findUnique({ where: { key: ADMIN_TRENDING_KEY } }).catch(() => null);
  return { tips: cleanTrendingTips(row?.value), updatedAt: row?.updatedAt ?? null };
}

export async function saveAdminTrendingTips(ctx: AdminContext, tips: readonly TrendingTip[]): Promise<void> {
  const clean = cleanTrendingTips(tips);
  await prisma.$transaction(async (tx) => {
    const before = await tx.adminSetting.findUnique({ where: { key: ADMIN_TRENDING_KEY } });
    await tx.adminSetting.upsert({ where: { key: ADMIN_TRENDING_KEY }, create: { key: ADMIN_TRENDING_KEY, value: json(clean) }, update: { value: json(clean) } });
    await writeAudit(tx, ctx, "update_trending_sounds", `setting:${ADMIN_TRENDING_KEY}`, before?.value ?? null, clean);
  });
}

/**
 * The week's trending sounds for the "Post manually" tip: this company's own Facebook Login account's list when it has
 * one, else the freshest list Meta gave any account this week, else the admin's list. Never throws.
 */
export async function weekTrendingTips(businessId: string, now = new Date()): Promise<TrendingTip[]> {
  try {
    const own = await prisma.connection.findMany({ where: { businessId, provider: "instagram", method: "DIRECT", status: "ACTIVE", scopes: { has: "instagram_content_publish" } }, select: { externalAccountId: true } });
    const keys = own.map((c) => `${CACHE_PREFIX}${c.externalAccountId}`);
    const rows = await prisma.adminSetting.findMany({
      where: { key: { startsWith: CACHE_PREFIX }, updatedAt: { gte: new Date(now.getTime() - WEEK_MS) } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    const ordered = [...rows.filter((r) => keys.includes(r.key)), ...rows.filter((r) => !keys.includes(r.key))];
    for (const row of ordered) {
      const tips = tipsFromAudio(readCached(row.value)?.items ?? []);
      if (tips.length) return tips.slice(0, 5);
    }
  } catch {
    // The admin's list below.
  }
  return (await adminTrendingTips()).tips.slice(0, 5);
}
