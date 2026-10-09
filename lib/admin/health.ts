import "server-only";
import { prisma } from "@/lib/db";
import { CRON_JOBS, cronStatus, type CronStatus, type LastRun } from "./cron";
import { APPROVAL_TTL_MS } from "./service";
import { scrubSecrets } from "./scrub";
import { disabledNetworks } from "./switch";
import { NEEDS_RECONNECT_PREFIX } from "@/lib/social/connections";

export type HealthStatus = "ok" | "warning" | "problem";
export type HealthIssue = { level: "warning" | "problem"; key: string; text: string; href: string };

export type Queues = {
  /** SCHEDULED more than 10 minutes in the past. */
  postsOverdue: number;
  /** PUBLISHING with a claim older than 15 minutes. */
  postsStuck: number;
  needsAction: number;
  webhookPending: number;
  webhookFailed24h: number;
  webhookTotal24h: number;
  pendingApprovals: number;
  oldestApprovalHours: number | null;
};

export type ErrorsHealth = {
  lastHour: number;
  last24h: number;
  /** 24 hourly counts, oldest first, ending with the current hour. */
  perHour: { hour: string; count: number }[];
  top: { source: string; message: string; count: number }[];
};

export type DbHealth = { sizeBytes: number; limitBytes: number; tables: { name: string; bytes: number }[] };
export type StorageHealth = { bucket: string; objects: number; bytes: number }[];

export type SystemHealth = {
  generatedAt: string;
  status: HealthStatus;
  issues: HealthIssue[];
  crons: CronStatus[];
  queues: Queues;
  errors: ErrorsHealth;
  db: DbHealth | null;
  storage: StorageHealth | null;
};

type EvalInput = { crons: Pick<CronStatus, "job" | "label" | "state" | "failures24h" | "runs24h" | "overdueByMinutes">[]; queues: Queues; errors: Pick<ErrorsHealth, "lastHour">; db: Pick<DbHealth, "sizeBytes" | "limitBytes"> | null };

/** The one overall status and the reasons for it. Pure: the rules are the contract (tests/admin-health.test.ts). */
export function evaluateHealth({ crons, queues, errors, db }: EvalInput): { status: HealthStatus; issues: HealthIssue[] } {
  const issues: HealthIssue[] = [];
  const add = (level: HealthIssue["level"], key: string, text: string, href = "/admin/health") => issues.push({ level, key, text, href });

  for (const c of crons) {
    if (c.state === "overdue") add(c.job === "publish" ? "problem" : "warning", `cron:${c.job}`, `${c.label} has not run for ${c.overdueByMinutes ?? "?"} minutes past its time.`);
    else if (c.state === "failed") add(c.failures24h >= 3 && c.failures24h === c.runs24h ? "problem" : "warning", `cron:${c.job}`, `${c.label} failed on its last run (${c.failures24h} of ${c.runs24h} in 24 hours).`);
  }
  if (queues.postsOverdue >= 1) add(queues.postsOverdue >= 5 ? "problem" : "warning", "posts-overdue", `${queues.postsOverdue} scheduled post${queues.postsOverdue === 1 ? " is" : "s are"} more than 10 minutes late.`);
  if (queues.postsStuck >= 1) add(queues.postsStuck >= 3 ? "problem" : "warning", "posts-stuck", `${queues.postsStuck} post${queues.postsStuck === 1 ? " is" : "s are"} stuck while publishing.`);
  if (queues.webhookTotal24h >= 10) {
    const rate = queues.webhookFailed24h / queues.webhookTotal24h;
    if (rate > 0.2) add(rate > 0.5 ? "problem" : "warning", "webhooks", `${Math.round(rate * 100)}% of webhook deliveries failed in the last 24 hours.`);
  }
  if (queues.webhookPending > 100) add("warning", "webhook-backlog", `${queues.webhookPending} webhook deliveries are waiting to be retried.`);
  if (queues.oldestApprovalHours !== null && queues.oldestApprovalHours >= 48) add("warning", "approvals", `A money request has waited ${Math.floor(queues.oldestApprovalHours / 24)} days for your approval.`, "/admin/approvals");
  if (errors.lastHour >= 10) add(errors.lastHour >= 50 ? "problem" : "warning", "errors", `${errors.lastHour} errors in the last hour.`, "/admin/errors");
  if (db && db.limitBytes > 0) {
    const used = db.sizeBytes / db.limitBytes;
    if (used >= 0.7) add(used >= 0.9 ? "problem" : "warning", "db-size", `The database is ${Math.round(used * 100)}% of its ${Math.round(db.limitBytes / 1_000_000)} MB limit.`);
  }
  const status: HealthStatus = issues.some((i) => i.level === "problem") ? "problem" : issues.length ? "warning" : "ok";
  return { status, issues };
}

// ---- cached heavy reads ------------------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const DB_LIMIT_BYTES = (Number(process.env.DB_SIZE_LIMIT_MB) || 500) * 1_000_000;

async function loadDb(): Promise<DbHealth | null> {
  try {
    const [size, tables] = await Promise.all([
      prisma.$queryRaw<{ s: bigint }[]>`select pg_database_size(current_database()) as s`,
      prisma.$queryRaw<{ name: string; b: bigint }[]>`
        select c.relname as name, pg_total_relation_size(c.oid) as b
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname = 'public' order by b desc limit 8`,
    ]);
    return { sizeBytes: Number(size[0]?.s ?? 0), limitBytes: DB_LIMIT_BYTES, tables: tables.map((t) => ({ name: t.name, bytes: Number(t.b) })) };
  } catch {
    return null;
  }
}

async function loadStorage(): Promise<StorageHealth | null> {
  try {
    const rows = await prisma.$queryRaw<{ bucket: string; n: bigint; b: bigint }[]>`
      select bucket_id as bucket, count(*) as n, coalesce(sum((metadata->>'size')::bigint), 0) as b
      from storage.objects group by bucket_id order by b desc`;
    return rows.map((r) => ({ bucket: r.bucket, objects: Number(r.n), bytes: Number(r.b) }));
  } catch {
    return null;
  }
}

export async function loadCrons(now = new Date()): Promise<CronStatus[]> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [last, counts] = await Promise.all([
    prisma.$queryRaw<{ job: string; startedAt: Date; finishedAt: Date; ok: boolean; summary: string | null; error: string | null }[]>`
      select distinct on (job) job, "startedAt", "finishedAt", ok, summary, error from "CronRun" order by job, "startedAt" desc`,
    prisma.cronRun.groupBy({ by: ["job", "ok"], where: { startedAt: { gte: since } }, _count: { _all: true } }),
  ]);
  return CRON_JOBS.map((job) => {
    const l = last.find((r) => r.job === job.job);
    const lastRun: LastRun = l ? { startedAt: new Date(l.startedAt), finishedAt: new Date(l.finishedAt), ok: l.ok, summary: l.summary, error: l.error } : null;
    const mine = counts.filter((c) => c.job === job.job);
    return cronStatus(job, lastRun, { failures24h: mine.filter((c) => !c.ok).reduce((s, c) => s + c._count._all, 0), runs24h: mine.reduce((s, c) => s + c._count._all, 0) }, now);
  });
}

async function loadQueues(now: Date): Promise<Queues> {
  const day = new Date(now.getTime() - 24 * 3_600_000);
  // Posts held on purpose are not late: a network switched off by you, a channel that needs reconnecting, or a retry set for later.
  const offNetworks = await disabledNetworks().catch(() => [] as string[]);
  const [postsOverdue, postsStuck, needsAction, webhookPending, hooks, pendingApprovals, oldest] = await Promise.all([
    prisma.post.count({
      where: {
        status: "SCHEDULED",
        scheduledAt: { lt: new Date(now.getTime() - 10 * 60_000) },
        ...(offNetworks.length ? { network: { notIn: offNetworks } } : {}),
        AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, { OR: [{ lastError: null }, { NOT: { lastError: { startsWith: NEEDS_RECONNECT_PREFIX } } }] }],
      },
    }),
    prisma.post.count({ where: { status: "PUBLISHING", lockedAt: { lt: new Date(now.getTime() - 15 * 60_000) } } }),
    prisma.post.count({ where: { status: "NEEDS_ACTION" } }),
    prisma.webhookDelivery.count({ where: { status: "pending" } }),
    prisma.webhookDelivery.groupBy({ by: ["status"], where: { createdAt: { gte: day }, status: { not: "pending" } }, _count: { _all: true } }),
    prisma.adminApproval.count({ where: { status: "pending", createdAt: { gt: new Date(now.getTime() - APPROVAL_TTL_MS) } } }),
    prisma.adminApproval.findFirst({ where: { status: "pending", createdAt: { gt: new Date(now.getTime() - APPROVAL_TTL_MS) } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const total = hooks.reduce((s, h) => s + h._count._all, 0);
  const failed = hooks.filter((h) => h.status === "failed").reduce((s, h) => s + h._count._all, 0);
  return {
    postsOverdue,
    postsStuck,
    needsAction,
    webhookPending,
    webhookFailed24h: failed,
    webhookTotal24h: total,
    pendingApprovals,
    oldestApprovalHours: oldest ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / 3_600_000) : null,
  };
}

async function loadErrors(now: Date): Promise<ErrorsHealth> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [hours, top] = await Promise.all([
    prisma.$queryRaw<{ h: Date; n: bigint }[]>`select date_trunc('hour', "createdAt") as h, count(*) as n from "ErrorLog" where level = 'error' and "createdAt" >= ${since} group by 1 order by 1`,
    prisma.errorLog.groupBy({ by: ["source", "message"], where: { level: "error", createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take: 8 }),
  ]);
  const byHour = new Map(hours.map((r) => [new Date(r.h).toISOString().slice(0, 13), Number(r.n)]));
  const perHour = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getTime() - (23 - i) * 3_600_000);
    const key = d.toISOString().slice(0, 13);
    return { hour: `${key}:00Z`, count: byHour.get(key) ?? 0 };
  });
  return {
    lastHour: perHour[23].count,
    last24h: perHour.reduce((s, h) => s + h.count, 0),
    perHour,
    top: top.map((t) => ({ source: t.source, message: scrubSecrets(t.message, 200), count: t._count._all })),
  };
}

export async function getSystemHealth(now = new Date()): Promise<SystemHealth> {
  const [crons, queues, errors, db, storage] = await Promise.all([
    loadCrons(now),
    loadQueues(now),
    loadErrors(now),
    cached("db", 5 * 60_000, loadDb),
    cached("storage", 10 * 60_000, loadStorage),
  ]);
  const { status, issues } = evaluateHealth({ crons, queues, errors, db });
  return { generatedAt: now.toISOString(), status, issues, crons, queues, errors, db, storage };
}

/** The status and issues for the sidebar badge and the Overview box: the full health read, kept for a minute. */
export async function getHealthSummary(): Promise<{ status: HealthStatus; issues: HealthIssue[] }> {
  return cached("summary", 60_000, async () => {
    const h = await getSystemHealth();
    return { status: h.status, issues: h.issues };
  });
}
