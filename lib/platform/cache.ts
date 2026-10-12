import { currentPlatform, type Platform } from "./detect";

// A cache shared across requests, for bytes that are slow to make again (rendered designs, fonts). Cloudflare: the
// Workers Cache API (`caches.default`, per data centre). Netlify: the Netlify Cache API (`caches.open`, per region,
// emptied on every deploy; at most 20 writes and 100 reads per invocation). Plain Node has neither, so the cache is
// absent and callers carry on without it.

const NAME = "bupulse";

/** The host's shared cache, or undefined when there is none. Never throws. */
export async function sharedCache(platform: Platform = currentPlatform()): Promise<Cache | undefined> {
  const storage = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  if (!storage) return undefined;
  try {
    if (platform === "netlify") return await storage.open(NAME);
    return storage.default;
  } catch {
    return undefined;
  }
}
