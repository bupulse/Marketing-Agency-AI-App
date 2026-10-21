// The Cloudflare Worker entry (wrangler.jsonc "main"). It wraps the worker OpenNext generates, so the web app
// is served exactly as before, and adds a `scheduled` handler for the Cron Triggers in wrangler.jsonc:
//   every minute -> POST /api/cron/publish  (publishes due posts)
//   hourly :37   -> POST /api/cron/leads-digest  (daily leads summary at 08:00 business time)
//   hourly       -> POST /api/cron/metrics  (collects post metrics, at most once a day per post)
//   daily 03:47  -> POST /api/cron/store-sync  (re-syncs imported store products, cursor calls)
//   daily 02:17  -> POST /api/cron/analytics-rollup  (daily analytics roll-up and back-fill, cursor calls)
//   daily 04:29  -> POST /api/cron/plan-price-changes  (price-change notices and swaps, archives old Paddle prices, cursor calls)
//   daily 05:41  -> POST /api/cron/momo-renewals  (Mobile Money renewal reminders, grace period, cursor calls)
//   hourly :53   -> POST /api/cron/trial-reminders  (trial-end reminders for clients without a card, and trial expiry)
//   daily 03:19  -> POST /api/cron/media-cleanup  (deletes content videos 30 days after their posts went out)
//   hourly :07   -> POST /api/cron/content-summary  (daily email of auto-scheduled posts, from 08:00 local, cursor calls)
//   hourly :13   -> POST /api/cron/daily-posts  (daily posts made for you, local midnight to midday, cursor calls)
//   6-hourly :31 -> POST /api/cron/creator-views  (creators' post views, link checks, period closes, cursor calls)
// The handler calls the app's own routes through the self-reference binding, so the routes keep one set of
// rules (CRON_SECRET bearer check) whether Cloudflare, GitHub Actions or a person calls them.
// Not type-checked with the app (tsconfig excludes it): ./.open-next only exists after `opennextjs-cloudflare build`.
import handler from "./.open-next/worker.js";
// The image codecs for Instagram's JPEG-only rule (lib/publishing/jpeg.ts). Wrangler compiles .wasm imports.
import pngWasm from "./node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import webpDecodeWasm from "./node_modules/@jsquash/webp/codec/dec/webp_dec.wasm";
import jpegDecodeWasm from "./node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import jpegEncodeWasm from "./node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm";
// Prisma's query compiler: workerd cannot compile WebAssembly from bytes at runtime, so the client takes this module
// (scripts/cf-build.mjs writes the file, the size-optimised "small" build, and points the generated client here).
import prismaQueryCompilerWasm from "./.open-next/prisma/query_compiler_small_bg.wasm";

(globalThis as { __bupulseWasm?: unknown }).__bupulseWasm = { png: pngWasm, webpDecode: webpDecodeWasm, jpegEncode: jpegEncodeWasm, jpegDecode: jpegDecodeWasm, prismaQueryCompiler: prismaQueryCompilerWasm };

// The main module's named exports are Worker entrypoints (Durable Object classes): workerd refuses to start when one is
// a plain value ("Incorrect type for map entry"), so the cron schedules live in worker-crons.ts.
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

type Env = CloudflareEnv & { CRON_SECRET?: string };

import { AUTOPILOT_CRON, ANALYTICS_ROLLUP_CRON, CONTENT_SUMMARY_CRON, CREATOR_VIEWS_CRON, DAILY_POSTS_CRON, MOMO_RENEWALS_CRON, PLAN_PRICE_CRON, routeForCron, STORE_SYNC_CRON } from "./worker-crons";

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
    if (controller.cron === MOMO_RENEWALS_CRON) return ctx.waitUntil(runCursorCron("/api/cron/momo-renewals", env));
    if (controller.cron === ANALYTICS_ROLLUP_CRON) return ctx.waitUntil(runCursorCron("/api/cron/analytics-rollup", env));
    if (controller.cron === CONTENT_SUMMARY_CRON) return ctx.waitUntil(runCursorCron("/api/cron/content-summary", env));
    if (controller.cron === DAILY_POSTS_CRON) return ctx.waitUntil(runCursorCron("/api/cron/daily-posts", env));
    if (controller.cron === CREATOR_VIEWS_CRON) return ctx.waitUntil(runCursorCron("/api/cron/creator-views", env));
    const path = routeForCron(controller.cron);
    if (!path) return console.error(`[cron] unknown schedule "${controller.cron}"; check wrangler.jsonc against worker.ts`);
    ctx.waitUntil(runCron(path, env));
  },
};

export default worker;
