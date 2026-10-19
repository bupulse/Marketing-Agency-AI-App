import "server-only";
import { prisma } from "@/lib/db";

// The monthly count of Composio calls, all businesses together, so BuPulse stays inside Composio's free calls
// (docs/SOCIAL_INBOX.md, "Budget"). Every call to Composio's API is counted (posting too, in lib/social/composio/client.ts);
// the inbox check and inbox replies *reserve* their calls first, and a reservation that would pass the limit is
// refused, atomically, so two checks at once can never overshoot. Posting is counted but never stopped.
//
// One AdminSetting row per calendar month (UTC): key "composio.calls.YYYY-MM", value a JSON number.

export const usageKey = (now = new Date()) => `composio.calls.${now.toISOString().slice(0, 7)}`;

/** Calls kept back for replies: the inbox check stops this many calls before the monthly limit. */
export const replyReserve = (cap: number) => Math.min(500, Math.floor(cap * 0.05));

/** The limit the inbox check may use (the monthly limit minus the replies' reserve). */
export const pollLimit = (cap: number) => Math.max(0, cap - replyReserve(cap));

/**
 * Reserves `n` calls if the month's count stays at or under `limit`. Returns false (nothing counted) when it would
 * not, or when the database cannot be reached: without a count there is no call.
 */
export async function reserveComposioCalls(n: number, limit: number, now = new Date()): Promise<boolean> {
  if (n <= 0) return true;
  if (n > limit) return false;
  const key = usageKey(now);
  try {
    const rows = await prisma.$queryRaw<{ used: number }[]>`
      INSERT INTO "AdminSetting" ("key", "value", "updatedAt") VALUES (${key}, to_jsonb(${n}::int), now())
      ON CONFLICT ("key") DO UPDATE SET "value" = to_jsonb(("AdminSetting"."value" #>> '{}')::int + ${n}::int), "updatedAt" = now()
      WHERE ("AdminSetting"."value" #>> '{}')::int + ${n}::int <= ${limit}::int
      RETURNING ("value" #>> '{}')::int AS "used"`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Counts `n` calls that were made anyway (posting). Never throws and never blocks the caller's work. */
export async function countComposioCalls(n = 1, now = new Date()): Promise<void> {
  const key = usageKey(now);
  try {
    await prisma.$executeRaw`
      INSERT INTO "AdminSetting" ("key", "value", "updatedAt") VALUES (${key}, to_jsonb(${n}::int), now())
      ON CONFLICT ("key") DO UPDATE SET "value" = to_jsonb(("AdminSetting"."value" #>> '{}')::int + ${n}::int), "updatedAt" = now()`;
  } catch {
    // a missed count only makes the check a little generous; the limit keeps a margin below Composio's free calls
  }
}

/** Composio calls counted this month. */
export async function composioCallsThisMonth(now = new Date()): Promise<number> {
  const row = await prisma.adminSetting.findUnique({ where: { key: usageKey(now) } }).catch(() => null);
  const n = Number(row?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
