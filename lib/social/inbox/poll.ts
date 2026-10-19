import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { hasFeature } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { ingestInbound } from "@/lib/inbox/ingest";
import { cancelJob, registerJobHandler, scheduleJob } from "@/lib/jobs/due";
import { runTool } from "../composio/client";
import { composioCallsThisMonth, pollLimit, reserveComposioCalls } from "./budget";
import { CallLimitError, MAX_CALLS_PER_CHECK, pollAccount, type PollAccount } from "./composio-poll";
import { newCursor, parseCursor, type InboxCursor } from "./cursor";
import { CALLS_PER_QUIET_CHECK, isNight, minutesUntilMorning, nextCheckAt, pacedMinutes } from "./schedule";
import { getInboxSettings } from "./settings";
import { composioReady } from "./transport";

// The inbox check as due jobs (lib/jobs/due.ts): one pending "social.poll" job per switched-on account
// (dedupeKey "poll:<connectionId>"), which checks the account (composio-poll.ts) and schedules its own next run
// (schedule.ts). A "social.poll.sweep" job every hour restarts any account whose chain stopped (a crash, the transport
// switched back, Composio switched on again). docs/SOCIAL_INBOX.md.

export const POLL_KIND = "social.poll";
export const SWEEP_KIND = "social.poll.sweep";
export const pollKey = (connectionId: string) => `poll:${connectionId}`;
const SWEEP_KEY = "poll:sweep";
const SWEEP_MINUTES = 60;
/** When BuPulse-Socials is off or the month's calls are used up: look again later, without calling anyone. */
const WAIT_MINUTES = 60;
const LIMIT_WAIT_MINUTES = 6 * 60;

const INBOX_NETWORKS = ["instagram", "facebook"];

/**
 * Schedules the job again for later. The running job still holds its dedupeKey (the runner clears it when the handler
 * returns), so it lets go of it first; otherwise scheduling would update the running row and the runner would then
 * mark it DONE. Safe to run twice: a second call just moves the new pending job.
 */
async function scheduleAgain(jobId: string, input: Parameters<typeof scheduleJob>[0]) {
  await prisma.dueJob.updateMany({ where: { id: jobId, dedupeKey: input.dedupeKey }, data: { dedupeKey: null } });
  await scheduleJob(input);
}

/** Starts (or moves to now) the checks of one account, and makes sure the hourly sweep runs. */
export async function startPolling(connectionId: string, businessId: string, at = new Date()): Promise<void> {
  await scheduleJob({ kind: POLL_KIND, runAt: at, businessId, dedupeKey: pollKey(connectionId), payload: { connectionId } });
  await ensureSweep();
}

export async function stopPolling(connectionId: string): Promise<void> {
  await cancelJob(pollKey(connectionId));
}

export async function ensureSweep(): Promise<void> {
  const pending = await prisma.dueJob.findUnique({ where: { dedupeKey: SWEEP_KEY }, select: { id: true } });
  if (!pending) await scheduleJob({ kind: SWEEP_KIND, runAt: new Date(Date.now() + SWEEP_MINUTES * 60_000), dedupeKey: SWEEP_KEY });
}

/** Switched-on accounts this route checks (method COMPOSIO). */
const pollWhere = { inboxEnabled: true, method: "COMPOSIO" as const, provider: { in: INBOX_NETWORKS }, status: { in: ["ACTIVE" as const, "EXPIRING" as const] } };

/** Restarts the checks of every switched-on account that has no job waiting. Returns how many were restarted. */
export async function sweep(now = new Date()): Promise<number> {
  const settings = await getInboxSettings();
  if (settings.transport !== "composio") return 0;
  const rows = await prisma.connection.findMany({ where: pollWhere, select: { id: true, businessId: true } });
  if (!rows.length) return 0;
  const jobs = await prisma.dueJob.findMany({ where: { dedupeKey: { in: rows.map((r) => pollKey(r.id)) } }, select: { dedupeKey: true } });
  const have = new Set(jobs.map((j) => j.dedupeKey));
  let started = 0;
  for (const r of rows) {
    if (have.has(pollKey(r.id)) || !(await hasFeature(r.businessId, "inbox"))) continue;
    await scheduleJob({ kind: POLL_KIND, runAt: now, businessId: r.businessId, dedupeKey: pollKey(r.id), payload: { connectionId: r.id } });
    started++;
  }
  return started;
}

type Handled = { outcome: "stopped" | "waiting" | "night" | "limit" | "checked"; next: Date | null; found?: number };

/** One check of one account. Exported for the tests; the job handler below wraps it. */
export async function runPoll(connectionId: string, now = new Date()): Promise<Handled> {
  const row = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { id: true, businessId: true, provider: true, method: true, status: true, inboxEnabled: true, inboxCursor: true, externalAccountId: true, displayName: true, accessTokenEncrypted: true, business: { select: { timezone: true } } },
  });
  const settings = await getInboxSettings();
  // Switched off, disconnected, needing a reconnect, or on the other route: the chain stops (the sweep restarts it).
  if (!row || !row.inboxEnabled || !INBOX_NETWORKS.includes(row.provider) || row.method !== "COMPOSIO" || !row.accessTokenEncrypted || (row.status !== "ACTIVE" && row.status !== "EXPIRING") || settings.transport !== "composio") {
    return { outcome: "stopped", next: null };
  }
  // The plan lost the Inbox feature: no more calls for this business (switching it back on restarts the checks).
  if (!(await hasFeature(row.businessId, "inbox"))) return { outcome: "stopped", next: null };
  if (!(await composioReady())) return { outcome: "waiting", next: new Date(now.getTime() + WAIT_MINUTES * 60_000) };
  const tz = row.business.timezone || "UTC";
  if (isNight(now, tz)) return { outcome: "night", next: new Date(now.getTime() + minutesUntilMorning(now, tz) * 60_000) };

  const limit = pollLimit(settings.monthlyCap);
  const used = await composioCallsThisMonth(now);
  const cursor0: InboxCursor = row.inboxCursor ? parseCursor(row.inboxCursor, now) : newCursor(now);
  if (used + CALLS_PER_QUIET_CHECK > limit) {
    await saveCursor(row.id, { ...cursor0, lastError: "This month's limit of checks is reached." });
    return { outcome: "limit", next: new Date(now.getTime() + LIMIT_WAIT_MINUTES * 60_000) };
  }

  const connectedAccountId = await decrypt(row.accessTokenEncrypted);
  const network = row.provider as PollAccount["network"];
  let calls = 0;
  const call = async (slug: string, args: Record<string, unknown>) => {
    if (calls >= MAX_CALLS_PER_CHECK) throw new CallLimitError("check");
    if (!(await reserveComposioCalls(1, limit, now))) throw new CallLimitError("month");
    calls++;
    return runTool(network, slug, connectedAccountId, row.businessId, args, { reserved: true });
  };
  const account: PollAccount = {
    businessId: row.businessId,
    connectionId: row.id,
    channel: network === "instagram" ? "INSTAGRAM" : "FACEBOOK",
    network,
    externalAccountId: row.externalAccountId,
    handle: network === "instagram" ? row.displayName : null,
  };
  const result = await pollAccount({ account, cursor: cursor0, call, ingest: ingestInbound, now });
  await saveCursor(row.id, result.cursor);
  if (result.limited === "month") return { outcome: "limit", next: new Date(now.getTime() + LIMIT_WAIT_MINUTES * 60_000), found: result.found };

  const accounts = await prisma.connection.count({ where: pollWhere });
  const paced = pacedMinutes({ now, callsLeft: limit - (await composioCallsThisMonth(now)), accounts });
  const activity = result.cursor.activityAt ? new Date(result.cursor.activityAt) : null;
  // More waiting than one check could read: look again soon instead of at the quiet pace.
  const next = result.limited === "check" ? new Date(now.getTime() + 5 * 60_000) : nextCheckAt({ now, timeZone: tz, lastActivityAt: activity, paced, errors: result.cursor.errors });
  return { outcome: "checked", next, found: result.found };
}

async function saveCursor(connectionId: string, cursor: InboxCursor) {
  await prisma.connection.updateMany({ where: { id: connectionId }, data: { inboxCursor: cursor as unknown as Prisma.InputJsonValue } });
}

registerJobHandler(POLL_KIND, async (job) => {
  const connectionId = String((job.payload as { connectionId?: unknown } | null)?.connectionId ?? "");
  if (!connectionId) return;
  let handled: Handled;
  try {
    handled = await runPoll(connectionId);
  } catch (error) {
    // Expected failures are recorded on the cursor; this is the unexpected (database, decryption). Try again in a
    // while rather than letting the runner give up on the account after five tries.
    await logError(error, { source: "social.inbox.poll", businessId: job.businessId ?? undefined, level: "warn" });
    handled = { outcome: "waiting", next: new Date(Date.now() + 30 * 60_000) };
  }
  if (handled.next) await scheduleAgain(job.id, { kind: POLL_KIND, runAt: handled.next, businessId: job.businessId, dedupeKey: pollKey(connectionId), payload: { connectionId } });
});

registerJobHandler(SWEEP_KIND, async (job) => {
  await sweep();
  // Only while BuPulse-Socials is the route; switching back to it in Admin starts the sweep again.
  if ((await getInboxSettings()).transport === "composio") {
    await scheduleAgain(job.id, { kind: SWEEP_KIND, runAt: new Date(Date.now() + SWEEP_MINUTES * 60_000), dedupeKey: SWEEP_KEY });
  }
});
