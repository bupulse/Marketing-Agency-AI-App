// "Active now" on the sales room TV: a signed-in person who uses the dashboard has User.lastSeenAt refreshed, at most
// every 2 minutes. Cheap and harmless: a per-server memory skips most requests, the write itself only matches when the
// stored time is older than 2 minutes, it runs after the response, and a failure is ignored.
import "server-only";
import { prisma } from "@/lib/db";
import { waitUntil } from "@/lib/platform/background";

export const HEARTBEAT_EVERY_MS = 2 * 60 * 1000;
const recent = new Map<string, number>();

/** Notes that `userId` (the signed-in person) is using the dashboard. Never throws, never waits. */
export function heartbeat(userId: string, now = Date.now()): void {
  const last = recent.get(userId);
  if (last !== undefined && now - last < HEARTBEAT_EVERY_MS) return;
  recent.set(userId, now);
  // Keep the memory small: forget people not seen for a while.
  if (recent.size > 5_000) for (const [id, at] of recent) if (now - at >= HEARTBEAT_EVERY_MS) recent.delete(id);
  try {
    const write = prisma.user
      .updateMany({ where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now - HEARTBEAT_EVERY_MS) } }] }, data: { lastSeenAt: new Date(now) } })
      .then(() => undefined, () => undefined);
    waitUntil(write);
  } catch {
    /* never fails the page */
  }
}

/** Tests only. */
export function resetHeartbeat(): void {
  recent.clear();
}
