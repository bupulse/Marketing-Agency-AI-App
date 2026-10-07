// The Cloudflare Worker entry (wrangler.jsonc "main"). It wraps the worker OpenNext generates, so the web app
// is served exactly as before, and adds a `scheduled` handler for the Cron Triggers in wrangler.jsonc:
//   every minute -> POST /api/cron/publish  (publishes due posts)
//   hourly       -> POST /api/cron/metrics  (collects post metrics, at most once a day per post)
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

/** Must match "triggers.crons" in wrangler.jsonc. */
export const METRICS_CRON = "23 * * * *";

type Env = CloudflareEnv & { CRON_SECRET?: string };

/** Must match "triggers.crons" in wrangler.jsonc. Autopilot plans next week on Fridays and Saturdays. */
export const AUTOPILOT_CRON = "11 */3 * * 5,6";

export function routeForCron(cron: string): string {
  return cron === METRICS_CRON ? "/api/cron/metrics" : cron === AUTOPILOT_CRON ? "/api/cron/autopilot" : "/api/cron/publish";
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
async function runAutopilotCron(env: Env): Promise<void> {
  let cursor: string | null = null;
  for (let i = 0; i < 40; i++) {
    const body = await runCron(`/api/cron/autopilot${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, env);
    try {
      cursor = body ? ((JSON.parse(body) as { nextCursor?: string | null }).nextCursor ?? null) : null;
    } catch {
      cursor = null;
    }
    if (!cursor) return;
  }
}

const worker = {
  fetch: handler.fetch,

  async scheduled(controller: { cron: string }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(controller.cron === AUTOPILOT_CRON ? runAutopilotCron(env) : runCron(routeForCron(controller.cron), env));
  },
};

export default worker;
