import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { sendBackUpAlert, type AlertOutcome } from "./alerts";
import { watchCoversOutage } from "./watch";
import { gapOutage, longestGapMs, PC_SILENT_MS, type Outage, type UptimeCheckInput } from "./uptime-rules";

// Stores one check (POST /api/monitor/uptime: GitHub's outside check, or the server PC's own 5-minute check) and, when it is a good check after an outage, records the outage
// and sends the "back up" alert. The outage's start is unique (UptimeIncident.startedAt), so a check posted twice, or two
// at once, can never send the alert twice: only the request that created the row sends it.

export const CHECKS_KEEP_DAYS = 35;

type Db = Pick<typeof prisma, "uptimeCheck" | "uptimeIncident" | "monitorHeartbeat">;
type Deps = { db?: Db; alert?: (o: Outage) => Promise<Record<string, AlertOutcome>>; random?: () => number; watchCovers?: (o: Outage, now: Date) => Promise<boolean> };

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** Was the PC silent (no heartbeat for PC_SILENT_MS) inside [from, to]? Only when the PC had reported before `from`. */
async function pcSilentBetween(db: Db, from: Date, to: Date): Promise<boolean> {
  const before = await db.monitorHeartbeat.findFirst({ where: { receivedAt: { lte: from } }, select: { receivedAt: true } });
  if (!before) return false;
  const beats = await db.monitorHeartbeat.findMany({ where: { receivedAt: { gt: from, lt: to } }, select: { receivedAt: true }, orderBy: { receivedAt: "asc" }, take: 5_000 });
  return longestGapMs(beats.map((b) => b.receivedAt), from, to) > PC_SILENT_MS;
}

export async function recordUptimeCheck(input: UptimeCheckInput, now = new Date(), deps: Deps = {}): Promise<{ stored: true; outage: Outage | null; alerted: boolean }> {
  const db = deps.db ?? prisma;
  const alert = deps.alert ?? sendBackUpAlert;
  // The good check before this one, read before this one is written.
  const prev = input.ok ? await db.uptimeCheck.findFirst({ where: { ok: true, checkedAt: { lt: now } }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } }) : null;
  await db.uptimeCheck.create({
    data: { checkedAt: now, ok: input.ok, statusCode: input.statusCode, statusMs: input.statusMs, databaseMs: input.databaseMs, version: input.version, pages: input.pages, retried: input.retried, afterFailure: input.afterFailure },
  });
  if ((deps.random ?? Math.random)() < 0.05) {
    await db.uptimeCheck.deleteMany({ where: { checkedAt: { lt: new Date(now.getTime() - CHECKS_KEEP_DAYS * 86_400_000) } } }).catch(() => {});
  }
  if (!input.ok || !prev) return { stored: true, outage: null, alerted: false };

  // "After a failure" (the poster's previous check found the site down) is old news when the good check before this one
  // already closed an outage: the PC's own 5-minute check (scripts/monitor/pc-self-check.mjs) can end an outage before
  // GitHub's next run says so, and that must not record a second, made-up outage after it.
  const afterFailure = input.afterFailure && !(await db.uptimeIncident.findFirst({ where: { endedAt: prev.checkedAt }, select: { id: true } }));

  // Only a gap needs the slower look at what happened in it.
  const gap = now.getTime() - prev.checkedAt.getTime();
  const between = { failedChecks: 0, pcSilent: false };
  if (gap > 0 && !afterFailure) {
    between.failedChecks = await db.uptimeCheck.count({ where: { ok: false, checkedAt: { gt: prev.checkedAt, lt: now } } });
    if (!between.failedChecks) between.pcSilent = await pcSilentBetween(db, prev.checkedAt, now);
  }
  const outage = gapOutage(prev, { checkedAt: now, afterFailure }, between);
  if (!outage) return { stored: true, outage: null, alerted: false };

  let incidentId: string;
  try {
    incidentId = (await db.uptimeIncident.create({ data: { startedAt: outage.startedAt, endedAt: outage.endedAt, minutes: outage.minutes, reason: outage.reason }, select: { id: true } })).id;
  } catch (e) {
    if (isUniqueViolation(e)) return { stored: true, outage, alerted: false };
    throw e;
  }
  try {
    // The server PC's minute-by-minute watch (lib/monitor/watch.ts) saw this outage from its start and already sent its
    // own "down" and "back up" messages (or none, for a blip under 2 minutes): no second "back up" from here.
    const covered = deps.watchCovers ?? ((o: Outage, at: Date) => watchCoversOutage(o, at, db as Partial<Pick<typeof prisma, "adminSetting">>));
    if (await covered(outage, now)) {
      await db.uptimeIncident.update({ where: { id: incidentId }, data: { alertedAt: new Date(), alerts: { by: "pc-watch" } } });
      return { stored: true, outage, alerted: false };
    }
    const alerts = await alert(outage);
    await db.uptimeIncident.update({ where: { id: incidentId }, data: { alertedAt: new Date(), alerts } });
  } catch (error) {
    await logError(error, { source: "monitor.back-up-alert", level: "warn" });
  }
  return { stored: true, outage, alerted: true };
}
