import { getCloudflareContext } from "@opennextjs/cloudflare";
import { currentPlatform, type Platform } from "./detect";

// Work that keeps running after the response: Cloudflare's ctx.waitUntil, Netlify's context.waitUntil (through the
// request context Netlify's Next.js runtime installs, the same one next/server's after() uses), or, in plain Node
// (next dev, next start, tests), a promise that simply keeps running.
// Time limits differ: Cloudflare gives a waitUntil task about 30 s after the response; on Netlify the work counts
// towards the function's 60 s limit, measured from the start of the request.

type WaitUntil = (promise: Promise<unknown>) => void;

const NEXT_REQUEST_CONTEXT = Symbol.for("@next/request-context");

function netlifyWaitUntil(): WaitUntil | undefined {
  const g = globalThis as { Netlify?: { context?: { waitUntil?: WaitUntil } | null } } & Record<symbol, unknown>;
  const fromNext = (g[NEXT_REQUEST_CONTEXT] as { get?: () => { waitUntil?: WaitUntil } | undefined } | undefined)?.get?.()?.waitUntil;
  return fromNext ?? g.Netlify?.context?.waitUntil?.bind(g.Netlify.context);
}

function cloudflareWaitUntil(): WaitUntil | undefined {
  try {
    const { ctx } = getCloudflareContext();
    return ctx.waitUntil.bind(ctx);
  } catch {
    return undefined;
  }
}

/**
 * Hands `promise` to the host so it may finish after the response. Returns true when the host took it, false when
 * there is no request context (plain Node, or called outside a request), where the promise just keeps running.
 * Never throws; the promise should not reject (catch inside it).
 */
export function waitUntil(promise: Promise<unknown>, platform: Platform = currentPlatform()): boolean {
  // "node" tries both: `next dev` with initOpenNextCloudflareForDev, the tests that mock it, an undetected host.
  const wait = platform === "netlify" ? netlifyWaitUntil() : platform === "cloudflare" ? cloudflareWaitUntil() : (cloudflareWaitUntil() ?? netlifyWaitUntil());
  if (wait) {
    try {
      wait(promise);
      return true;
    } catch {
      // Treated as not taken below.
    }
  }
  if (mustNotLose(platform)) console.warn("[platform] Netlify gave no waitUntil for background work; the request waits for it instead (up to 10 s).");
  return false;
}

/** On Netlify in production the function freezes after the response, so work nobody waits for may never finish. */
const mustNotLose = (platform: Platform) => platform === "netlify" && process.env.NODE_ENV === "production";

/** How long a request waits for background work the host did not take (keepAlive). */
export const KEEP_ALIVE_MS = 10_000;

/**
 * waitUntil, and when Netlify (in production) did not take the work, waits for it, at most `maxMs`, so it is not lost
 * when the function freezes after the response. Resolves at once when the host took it, and everywhere else (Cloudflare
 * without a context, plain Node: the promise keeps running there). Never rejects. Await it before responding.
 */
export async function keepAlive(promise: Promise<unknown>, platform: Platform = currentPlatform(), maxMs = KEEP_ALIVE_MS): Promise<void> {
  if (waitUntil(promise, platform) || !mustNotLose(platform)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([promise.then(() => undefined, () => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, maxMs)))]);
  clearTimeout(timer);
}
