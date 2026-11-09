import "server-only";
import { prisma } from "@/lib/db";
import type { HeartbeatInput } from "./heartbeat-input";

// Stores the server PC's report (POST /api/monitor/heartbeat, once a minute) and, about once an hour, drops reports
// older than 30 days.

export const HEARTBEATS_KEEP_DAYS = 30;

type Db = Pick<typeof prisma, "monitorHeartbeat">;

export async function recordHeartbeat(input: HeartbeatInput, now = new Date(), deps: { db?: Db; random?: () => number } = {}): Promise<void> {
  const db = deps.db ?? prisma;
  await db.monitorHeartbeat.create({ data: { ...input, receivedAt: now } });
  if ((deps.random ?? Math.random)() < 1 / 60) {
    await db.monitorHeartbeat.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - HEARTBEATS_KEEP_DAYS * 86_400_000) } } }).catch(() => {});
  }
}
