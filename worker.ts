// The Cloudflare Worker entry (wrangler.jsonc "main"). It wraps the worker OpenNext generates, so the web app
// is served exactly as before, and adds a `scheduled` handler for the Cron Triggers in wrangler.jsonc:
//   every minute -> POST /api/cron/publish  (publishes due posts)
//   hourly :37   -> POST /api/cron/leads-digest  (daily leads summary at 08:00 business time)
//   hourly       -> POST /api/cron/metrics  (collects post metrics, at most once a day per post)
//   daily 03:47  -> POST /api/cron/store-sync  (re-syncs imported store products, cursor calls)
//   daily 02:17  -> POST /api/cron/analytics-rollup  (daily analytics roll-up and back-fill, cursor calls)
//   daily 04:29  -> POST /api/cron/plan-price-changes  (price-change notices and swaps, archives old Paddle prices, cursor calls)
//   hourly :53   -> POST /api/cron/trial-reminders  (trial-end reminders for clients without a card, and trial expiry)
// The handler calls the app's own routes through the self-reference binding, so the routes keep one set of
// rules (CRON_SECRET bearer check) whether Cloudflare, GitHub Actions or a person calls them.
// Not type-checked with the app (tsconfig excludes it): ./.open-next only exists after `opennextjs-cloudflare build`.
import handler from "./.open-next/worker.js";
// The image codecs for Instagram's JPEG-only rule (lib/publishing/jpeg.ts). Wrangler compiles .wasm imports.
import pngWasm from "./node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import webpDecodeWasm from "./node_modules/@jsquash/webp/codec/dec/webp_dec.wasm";
import jpegDecodeWasm from "./node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import jpegEncodeWasm from "./node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm";

(globalThis as { __bupulseWasm?: unknown }).__bupulseWasm = { png: pngWasm, webpDecode: webpDecodeWasm, jpegEncode: jpegEncodeWasm, jpegDecode: jpegDecodeWasm };

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

type Env = CloudflareEnv & { CRON_SECRET?: string };

// Each schedule must appear in "triggers.crons" in wrangler.jsonc (tests/worker-crons.test.ts checks both ways).
/** Every minute: publish due posts. */
export const PUBLISH_CRON = "* * * * *";
/** Hourly: collect post metrics; each post is measured at most once every 20 hours. */
export const METRICS_CRON = "23 * * * *";
/** Autopilot plans next week on Fridays and Saturdays. */
export const AUTOPILOT_CRON = "11 */3 * * 5,6";
/** Hourly; the route only sends the leads summary to businesses where it is 08:00. */
export const LEADS_DIGEST_CRON = "37 * * * *";
/** Daily at 03:47 UTC: re-sync imported Shopify and WooCommerce products (a few stores per call, with a cursor). */
export const STORE_SYNC_CRON = "47 3 * * *";

/** Daily at 02:17 UTC: analytics roll-up for yesterday and today, plus back-fill days (cursor calls). */
export const ANALYTICS_ROLLUP_CRON = "17 2 * * *";

/** Daily at 04:29 UTC: plan price changes (notice emails, moving clients to the new price before renewal), cursor calls. */
export const PLAN_PRICE_CRON = "29 4 * * *";

/** Hourly at :53: trial-end reminders (a day before and on the last day) and trials that are over become read-only. */
export const TRIAL_CRON = "53 * * * *";

export const CRON_ROUTES: Record<string, string> = {
  [PUBLISH_CRON]: "/api/cron/publish",
  [METRICS_CRON]: "/api/cron/metrics",
  [AUTOPILOT_CRON]: "/api/cron/autopilot",
  [LEADS_DIGEST_CRON]: "/api/cron/leads-digest",
  [STORE_SYNC_CRON]: "/api/cron/store-sync",
  [ANALYTICS_ROLLUP_CRON]: "/api/cron/analytics-rollup",
  [PLAN_PRICE_CRON]: "/api/cron/plan-price-changes",
  [TRIAL_CRON]: "/api/cron/trial-reminders",
};

/** The route for a schedule, or null for one this worker doesn't know (never fall back to publishing). */
export function routeForCron(cron: string): string | null {
  return CRON_ROUTES[cron] ?? null;
}

async function runCron(path: string, env: Env): Promise<string | null> {
  if (!env.CRON_SECRET) {
    console.error(`[cron] CRON_SECRET is not set; ${path} was not called`);
    return null;
  }
  const origin = env.NEXT_PUBLIC_SITE_URL || "https://bupulse.com";
  const response = await env.WORKER_SELF_REFERENCE.fetch(
    new Request(new URL(path, origin), { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } }),
  );
  const body = (await response.text()).slice(0, 500);
  if (!response.ok) console.error(`[cron] ${path} answered ${response.status}: ${body}`);
  else console.log(`[cron] ${path}: ${body}`);
  return response.ok ? body : null;
}

/** Autopilot answers a few businesses per call with a cursor; call again until it says there are no more. */
async function runCursorCron(path: string, env: Env): Promise<void> {
  let cursor: string | null = null;
  for (let i = 0; i < 40; i++) {
    const body = await runCron(`${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, env);
    try {
      cursor = body ? ((JSON.parse(body) as { nextCursor?: string | null }).nextCursor ?? null) : null;
    } catch {
      cursor = null;
    }
    if (!cursor) return;
  }
}

const runAutopilotCron = (env: Env) => runCursorCron("/api/cron/autopilot", env);

const worker = {
  fetch: handler.fetch,

  async scheduled(controller: { cron: string }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    if (controller.cron === AUTOPILOT_CRON) return ctx.waitUntil(runAutopilotCron(env));
    if (controller.cron === STORE_SYNC_CRON) return ctx.waitUntil(runCursorCron("/api/cron/store-sync", env));
    if (controller.cron === PLAN_PRICE_CRON) return ctx.waitUntil(runCursorCron("/api/cron/plan-price-changes", env));
    if (controller.cron === ANALYTICS_ROLLUP_CRON) return ctx.waitUntil(runCursorCron("/api/cron/analytics-rollup", env));
    const path = routeForCron(controller.cron);
    if (!path) return console.error(`[cron] unknown schedule "${controller.cron}"; check wrangler.jsonc against worker.ts`);
    ctx.waitUntil(runCron(path, env));
  },
};

export default worker;
