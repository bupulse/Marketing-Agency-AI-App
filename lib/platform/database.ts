import { getCloudflareContext } from "@opennextjs/cloudflare";
import { currentPlatform, type Platform } from "./detect";

// Where the database connection comes from. Cloudflare: the Hyperdrive binding, and a client per request (Workers
// cannot reuse sockets across requests). Netlify and plain Node: DATABASE_URL and one pooled client per instance;
// on Netlify use Supabase's transaction pooler (port 6543), because every function instance holds its own pool.

export type RequestDatabase = { connectionString: string; /** The request the client belongs to. */ scope: object };

/** Cloudflare's per-request Hyperdrive connection, or undefined (another host, or no binding: local dev and builds). */
export function requestDatabase(platform: Platform = currentPlatform()): RequestDatabase | undefined {
  if (platform === "netlify") return undefined;
  try {
    const { env, ctx } = getCloudflareContext();
    return env.HYPERDRIVE ? { connectionString: env.HYPERDRIVE.connectionString, scope: ctx } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Connections each pooled client may open. Netlify runs many small function instances, each with its own pool, so
 * keep it low there (DATABASE_POOL_MAX overrides, 1 to 20); elsewhere pg's default (10).
 */
export function poolMax(platform: Platform = currentPlatform()): number | undefined {
  const fromEnv = Number(process.env.DATABASE_POOL_MAX);
  if (Number.isInteger(fromEnv) && fromEnv >= 1 && fromEnv <= 20) return fromEnv;
  return platform === "netlify" ? 3 : undefined;
}
