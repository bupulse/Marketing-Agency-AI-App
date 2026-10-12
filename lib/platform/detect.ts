// Which host BuPulse runs on. Everything that differs between hosts (background work, the shared cache, the database
// connection, the visitor's country and IP, time limits) asks this first; see lib/platform/index.ts and
// docs/DEPLOY_NETLIFY.md. No server imports: the helpers here are pure and run in tests, Node and both hosts.

export type Platform = "cloudflare" | "netlify" | "node";

const KNOWN = new Set<Platform>(["cloudflare", "netlify", "node"]);

/** PLATFORM from the environment, then the build-time value next.config.ts inlines, else null. */
function configured(): Platform | null {
  for (const raw of [process.env.PLATFORM, process.env.BUPULSE_BUILD_PLATFORM]) {
    const value = (raw ?? "").trim().toLowerCase() as Platform;
    if (KNOWN.has(value)) return value;
  }
  return null;
}

/**
 * The host: PLATFORM=netlify|cloudflare|node when set (at runtime, or at build time through next.config.ts), else
 * auto-detected: Netlify Functions define the `Netlify` global, Cloudflare Workers identify themselves in
 * navigator.userAgent and OpenNext keeps the request context under a well-known symbol. "node" is everything else
 * (next dev, next start, tests), which keeps the behaviour BuPulse always had there.
 */
export function currentPlatform(): Platform {
  const forced = configured();
  if (forced) return forced;
  const g = globalThis as { Netlify?: unknown; navigator?: { userAgent?: string } } & Record<symbol, unknown>;
  if (g.Netlify) return "netlify";
  if (g.navigator?.userAgent === "Cloudflare-Workers" || g[Symbol.for("__cloudflare-context__")]) return "cloudflare";
  return "node";
}
