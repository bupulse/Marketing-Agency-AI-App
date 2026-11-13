import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { sendOwnerAlert, type AlertOutcome, type OwnerAlert } from "./alerts";
import { afterSend, delivered, EMPTY_WATCH, nextWatch, readWatchState, watchCovers, watchText, type WatchReport, type WatchSend, type WatchState } from "./watch-rules";
import { kigaliTime } from "./uptime-rules";

// The server PC's down watch (POST /api/monitor/watch, from scripts/self-host/windows/supervisor.mjs every minute).
// Its state is one AdminSetting row ("monitor.watch"); the rules are in watch-rules.ts. Only one PC posts, once a
// minute, so a read-then-write is enough; the message goes out after the state is computed and the delivery is written
// with it, so a message is never sent twice for one outage (and one that failed is tried again next minute).

export const WATCH_SETTING = "monitor.watch";

type Db = Pick<typeof prisma, "adminSetting">;
type Deps = { db?: Db; send?: (a: OwnerAlert) => Promise<Record<string, AlertOutcome>> };

export async function readWatch(db: Db = prisma): Promise<WatchState> {
  const row = await db.adminSetting.findUnique({ where: { key: WATCH_SETTING } });
  return row ? readWatchState(row.value) : EMPTY_WATCH;
}

async function saveWatch(db: Db, state: WatchState) {
  const value = state as unknown as Prisma.InputJsonValue;
  await db.adminSetting.upsert({ where: { key: WATCH_SETTING }, create: { key: WATCH_SETTING, value }, update: { value } });
}

function alertFor(send: WatchSend): OwnerAlert {
  const { subject, heading, line } = watchText(send);
  if (send.kind === "down") {
    return { subject, heading, line, emoji: "🔴", footer: "Checked from the server PC every minute through the public address. This is the only message until the site is back." };
  }
  return {
    subject,
    heading,
    line,
    emoji: "✅",
    blocks: [
      { label: "Down from", value: kigaliTime(send.outage.startedAt) },
      { label: "Up again", value: kigaliTime(send.outage.endedAt) },
    ],
    footer: send.downWasSent ? "Checked from the server PC every minute." : "The site was down for a while, but no message could go out while it lasted (the PC's internet or its website was down).",
  };
}

export async function recordWatchReport(report: WatchReport, now = new Date(), deps: Deps = {}): Promise<{ sent: WatchSend["kind"] | null; outcomes: Record<string, AlertOutcome> | null }> {
  const db = deps.db ?? prisma;
  const send = deps.send ?? sendOwnerAlert;
  const prev = await readWatch(db);
  const next = nextWatch(prev, report, now);
  let state = next.state;
  let outcomes: Record<string, AlertOutcome> | null = null;
  if (next.send) {
    try {
      outcomes = await send(alertFor(next.send));
    } catch (error) {
      outcomes = { email: "failed", telegram: "failed" };
      await logError(error, { source: "monitor.watch-alert", level: "warn" });
    }
    if (delivered(outcomes)) state = afterSend(state, next.send, now);
  }
  await saveWatch(db, state);
  return { sent: next.send && outcomes && delivered(outcomes) ? next.send.kind : null, outcomes };
}

/** For lib/monitor/uptime.ts: did the PC's watch already handle this outage's messages? False when it cannot tell. */
export async function watchCoversOutage(outage: { startedAt: Date; endedAt: Date }, now: Date, db: Partial<Db> = prisma): Promise<boolean> {
  try {
    if (!db.adminSetting) return false;
    return watchCovers(await readWatch(db as Db), outage, now);
  } catch {
    return false;
  }
}
