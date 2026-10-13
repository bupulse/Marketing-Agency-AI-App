// Netlify's side of the scheduled jobs (docs/DEPLOY_NETLIFY.md, Scheduled jobs). The same jobs as the Cloudflare
// Cron Triggers in worker.ts, at the same UTC schedules (tests/netlify-crons.test.ts keeps the two lists equal).
//
// Netlify stops a scheduled function after 30 s and any other function after 60 s, while a cron run can take longer
// (the cursor jobs call their route again and again). So each scheduled function only hands the job to the background
// function `cron-runner-background` (up to 15 minutes) and returns at once. The background function calls the app's
// own route with `Authorization: Bearer $CRON_SECRET`, exactly as worker.ts does, so the routes keep one set of rules
// whoever calls them. Each route call must finish inside Netlify's 60 s; lib/platform/limits.ts shortens the routes'
// own budgets on Netlify for that.

/** The parts of Netlify's Context the cron functions read (the full type lives in @netlify/functions). */
export type NetlifyContext = { site?: { url?: string | null } | null; waitUntil?: (promise: Promise<unknown>) => void };
/** Netlify's in-source function config (`export const config`). */
export type NetlifyConfig = { schedule?: string; background?: boolean; path?: string | string[] };

export type CronJob = { path: string; cursor: boolean };

/** Every job a scheduled function may start, and whether it uses the cursor-call pattern (call until nextCursor is null). */
export const CRON_JOBS: Record<string, CronJob> = {
  "/api/cron/publish": { path: "/api/cron/publish", cursor: false },
  "/api/cron/metrics": { path: "/api/cron/metrics", cursor: false },
  "/api/cron/autopilot": { path: "/api/cron/autopilot", cursor: true },
  "/api/cron/leads-digest": { path: "/api/cron/leads-digest", cursor: false },
  "/api/cron/store-sync": { path: "/api/cron/store-sync", cursor: true },
  "/api/cron/analytics-rollup": { path: "/api/cron/analytics-rollup", cursor: true },
  "/api/cron/plan-price-changes": { path: "/api/cron/plan-price-changes", cursor: true },
  "/api/cron/momo-renewals": { path: "/api/cron/momo-renewals", cursor: true },
  "/api/cron/trial-reminders": { path: "/api/cron/trial-reminders", cursor: false },
  "/api/cron/media-cleanup": { path: "/api/cron/media-cleanup", cursor: false },
};

export const RUNNER_PATH = "/.netlify/functions/cron-runner-background";
/** At most this many route calls per job (as worker.ts). */
export const MAX_CURSOR_CALLS = 40;
/** The runner starts no new route call after this long, leaving one 60 s call inside Netlify's 15 minutes. */
export const RUNNER_BUDGET_MS = 13 * 60 * 1000;
/** A single route call: Netlify stops the route's function at 60 s anyway. */
export const ROUTE_TIMEOUT_MS = 65_000;

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The site to call: this deploy's own site (Netlify's context, then the URL variable), else NEXT_PUBLIC_SITE_URL. */
export function siteOrigin(context: NetlifyContext | undefined, env: Env = process.env): string {
  const raw = context?.site?.url || env.URL || env.NEXT_PUBLIC_SITE_URL || "https://bupulse.com";
  return new URL(raw).origin;
}

/** Compares without stopping at the first different character. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Scheduled function body: asks the background runner to run `path`. Netlify answers 202 as soon as the runner
 * starts, so this takes well under a second. Never throws (a thrown scheduled function is only logged anyway).
 */
export async function startCron(path: string, context: NetlifyContext | undefined, env: Env = process.env, fetchImpl: FetchLike = fetch): Promise<boolean> {
  if (!env.CRON_SECRET) {
    console.error(`[cron] CRON_SECRET is not set; ${path} was not started`);
    return false;
  }
  try {
    const response = await fetchImpl(new URL(RUNNER_PATH, siteOrigin(context, env)).toString(), {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 202 && !response.ok) {
      console.error(`[cron] the runner answered ${response.status} for ${path}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[cron] could not start ${path}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

async function callRoute(url: string, secret: string, fetchImpl: FetchLike): Promise<string | null> {
  try {
    const response = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
    const body = (await response.text()).slice(0, 500);
    if (!response.ok) console.error(`[cron] ${new URL(url).pathname} answered ${response.status}: ${body}`);
    else console.log(`[cron] ${new URL(url).pathname}: ${body}`);
    return response.ok ? body : null;
  } catch (error) {
    console.error(`[cron] ${new URL(url).pathname} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Runs one job: one route call, or cursor calls until `nextCursor` is null (as worker.ts), within the runner's budget. */
export async function runJob(job: CronJob, origin: string, secret: string, fetchImpl: FetchLike = fetch, now: () => number = Date.now): Promise<number> {
  const started = now();
  let cursor: string | null = null;
  let calls = 0;
  for (; calls < (job.cursor ? MAX_CURSOR_CALLS : 1); ) {
    if (calls > 0 && now() - started > RUNNER_BUDGET_MS) {
      console.error(`[cron] ${job.path} stopped after ${calls} calls (time budget); the next run continues`);
      break;
    }
    const url = new URL(job.path, origin);
    if (cursor) url.searchParams.set("cursor", cursor);
    const body = await callRoute(url.toString(), secret, fetchImpl);
    calls += 1;
    if (!job.cursor) break;
    try {
      cursor = body ? ((JSON.parse(body) as { nextCursor?: string | null }).nextCursor ?? null) : null;
    } catch {
      cursor = null;
    }
    if (!cursor) break;
  }
  return calls;
}

/**
 * The background runner's body. Checks the bearer secret and that the job is one of CRON_JOBS, then runs it. Never
 * throws: Netlify retries a background function that fails, and a cron run must not run twice for that reason.
 */
export async function handleRunnerRequest(request: Request, context: NetlifyContext | undefined, env: Env = process.env, fetchImpl: FetchLike = fetch): Promise<{ status: number; calls: number }> {
  const secret = env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set");
    return { status: 500, calls: 0 };
  }
  if (request.method !== "POST" || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return { status: 401, calls: 0 };
  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const job = typeof body?.path === "string" && Object.hasOwn(CRON_JOBS, body.path) ? CRON_JOBS[body.path] : null;
  if (!job) return { status: 400, calls: 0 };
  try {
    return { status: 200, calls: await runJob(job, siteOrigin(context, env), secret, fetchImpl) };
  } catch (error) {
    console.error(`[cron] ${job.path} failed:`, error instanceof Error ? error.message : error);
    return { status: 500, calls: 0 };
  }
}
