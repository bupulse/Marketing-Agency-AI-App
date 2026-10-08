import "server-only";
import { prisma } from "@/lib/db";
import { utcDay } from "./collect";

// The daily salt for visitor hashes: a random value created on the day's first visit, kept in the database so every
// server instance uses the same one, and deleted by the roll-up job once the day has ended.
const cache = new Map<string, string>();

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Today's salt, or null if it can't be read or created (the caller then stores no hash at all). */
export async function getDailySalt(now = new Date()): Promise<string | null> {
  const day = utcDay(now);
  const cached = cache.get(day);
  if (cached) return cached;
  try {
    await prisma.$executeRaw`INSERT INTO "AnalyticsSalt" ("day", "salt") VALUES (${day}, ${randomSalt()}) ON CONFLICT ("day") DO NOTHING`;
    const row = await prisma.analyticsSalt.findUnique({ where: { day }, select: { salt: true } });
    if (!row) return null;
    for (const key of cache.keys()) if (key !== day) cache.delete(key);
    cache.set(day, row.salt);
    return row.salt;
  } catch (error) {
    console.error("[analytics] daily salt unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Removes salts of days that have ended. */
export async function purgeOldSalts(now = new Date()): Promise<number> {
  const { count } = await prisma.analyticsSalt.deleteMany({ where: { day: { lt: utcDay(now) } } });
  return count;
}
