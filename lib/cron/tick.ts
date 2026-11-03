import { dueRoutes } from "./schedule";

// The body of /api/cron/tick (Cloud Run, docs/DEPLOY_CLOUDRUN.md): runs the routes due in one minute, one after the
// other, inside the tick's own request. Cloud Run (request-based billing) throttles the CPU once a response is sent,
// so nothing may be left running after it: every route call is awaited. Each call goes to the app's own route with
// `Authorization: Bearer $CRON_SECRET`, as worker.ts and netlify/lib/cron.ts do, so the routes keep one set of rules.
// A route that answers { nextCursor } is called again with ?cursor= until it answers none (the cursor jobs).

/** At most this many calls of one route in one tick (as worker.ts). */
export const MAX_CURSOR_CALLS = 40;
/** A job starts no new cursor call after this long; the next run continues from where it stopped. */
export const JOB_BUDGET_MS = 10 * 60 * 1000;
/** One route call is given up after this long. */
export const ROUTE_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * No new job or cursor call starts after this long, so a tick ends within 25 minutes (this plus one call): inside
 * Cloud Scheduler's longest attempt deadline (30 minutes) and Cloud Run's request timeout (3600 s here).
 */
export const TICK_BUDGET_MS = 20 * 60 * 1000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type JobResult = { path: string; ok: boolean; calls: number; ms: number; status: number | null; error?: string };
export type TickSummary = { minute: string; jobs: JobResult[]; skipped: string[] };

type Options = { origin: string; secret: string; fetchImpl?: FetchLike; now?: () => number; routes?: Record<string, string>; /** No new call after this time (ms). */ stopAt?: number };

async function callRoute(url: URL, secret: string, fetchImpl: FetchLike): Promise<{ status: number | null; body: string | null; error?: string }> {
  try {
    const response = await fetchImpl(url.toString(), { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
    const body = (await response.text()).slice(0, 2000);
    if (!response.ok) {
      console.error(`[cron] ${url.pathname} answered ${response.status}: ${body.slice(0, 500)}`);
      return { status: response.status, body: null, error: `answered ${response.status}` };
    }
    console.log(`[cron] ${url.pathname}: ${body.slice(0, 500)}`);
    return { status: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cron] ${url.pathname} failed:`, message);
    return { status: null, body: null, error: message.slice(0, 200) };
  }
}

const nextCursorOf = (body: string | null): string | null => {
  try {
    const cursor = body ? (JSON.parse(body) as { nextCursor?: unknown }).nextCursor : null;
    return typeof cursor === "string" && cursor ? cursor : null;
  } catch {
    return null;
  }
};

/** One job: one route call, or cursor calls until there is no nextCursor, the call limit or the job's budget. Never throws. */
export async function runTickJob(path: string, { origin, secret, fetchImpl = fetch, now = Date.now, stopAt = Infinity }: Options): Promise<JobResult> {
  const started = now();
  let cursor: string | null = null;
  let calls = 0;
  let last: Awaited<ReturnType<typeof callRoute>> = { status: null, body: null };
  while (calls < MAX_CURSOR_CALLS) {
    if (calls > 0 && (now() - started > JOB_BUDGET_MS || now() > stopAt)) {
      console.error(`[cron] ${path} stopped after ${calls} calls (time budget); the next run continues`);
      break;
    }
    const url = new URL(path, origin);
    if (cursor) url.searchParams.set("cursor", cursor);
    last = await callRoute(url, secret, fetchImpl);
    calls += 1;
    cursor = nextCursorOf(last.body);
    if (!cursor) break;
  }
  return { path, ok: !last.error, calls, ms: now() - started, status: last.status, ...(last.error ? { error: last.error } : {}) };
}

/** Runs every job due at `minute` in order; one failing job never stops the others. Never throws. */
export async function runTick(minute: Date, options: Options): Promise<TickSummary> {
  const now = options.now ?? Date.now;
  const stopAt = now() + TICK_BUDGET_MS;
  const jobs: JobResult[] = [];
  const skipped: string[] = [];
  for (const path of dueRoutes(minute, options.routes)) {
    if (now() > stopAt) {
      skipped.push(path);
      continue;
    }
    jobs.push(await runTickJob(path, { ...options, stopAt }));
  }
  if (skipped.length) console.error(`[cron] tick ${minute.toISOString()} skipped ${skipped.join(", ")} (time budget)`);
  return { minute: minute.toISOString(), jobs, skipped };
}
