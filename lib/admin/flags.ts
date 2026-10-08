import "server-only";
import { prisma } from "@/lib/db";

const TTL_MS = 30_000;
type FlagRow = { enabled: boolean; rolloutPercent: number; userOverrides: Record<string, boolean> };
const cache = new Map<string, { at: number; flag: FlagRow | null }>();

export function clearFlagCache() {
  cache.clear();
}

/** Stable 0-99 bucket for a user and flag, so a 20% rollout keeps the same 20% of users. */
export function rolloutBucket(flag: string, userId: string): number {
  let h = 0x811c9dc5;
  const text = `${flag}:${userId}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Pure decision, exported for tests: per-user override first, then the switch, then the rollout percentage. */
export function flagDecision(flag: string, row: FlagRow | null, userId?: string | null): boolean {
  if (!row) return false;
  if (userId && Object.hasOwn(row.userOverrides, userId)) return row.userOverrides[userId] === true;
  if (!row.enabled) return false;
  if (row.rolloutPercent >= 100) return true;
  if (!userId) return false;
  return rolloutBucket(flag, userId) < row.rolloutPercent;
}

/** Is a feature flag on for this user? Unknown flags are off. Cached for 30 seconds per isolate. */
export async function isEnabled(flag: string, user?: string | { id: string } | null): Promise<boolean> {
  const userId = typeof user === "string" ? user : (user?.id ?? null);
  let entry = cache.get(flag);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    const row = await prisma.featureFlag.findUnique({ where: { key: flag } }).catch(() => null);
    entry = {
      at: Date.now(),
      flag: row
        ? {
            enabled: row.enabled,
            rolloutPercent: row.rolloutPercent,
            userOverrides: (row.userOverrides && typeof row.userOverrides === "object" ? row.userOverrides : {}) as Record<string, boolean>,
          }
        : null,
    };
    cache.set(flag, entry);
  }
  return flagDecision(flag, entry.flag, userId);
}
