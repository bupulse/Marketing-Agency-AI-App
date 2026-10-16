import "server-only";
import { keepAlive } from "@/lib/platform/background";

/**
 * Runs work after the response without making the visitor wait: the host's waitUntil on Cloudflare Workers and
 * Netlify (lib/platform/background.ts), a detached promise in Node. A failure is logged, never thrown.
 * The returned promise resolves at once, except on Netlify when the host could not take the work: then it waits for
 * it (at most 10 s, keepAlive), so callers should await it before they respond.
 */
export function runInBackground(task: () => Promise<unknown>, label: string): Promise<void> {
  const promise = Promise.resolve()
    .then(task)
    .catch((error) => console.error(`[leads] ${label} failed:`, error instanceof Error ? error.message : error));
  // Without a host (local dev, tests, next start) the promise simply keeps running.
  return keepAlive(promise);
}
