import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Runs work after the response without making the visitor wait: ctx.waitUntil on Cloudflare Workers,
 * a detached promise in Node. A failure is logged, never thrown.
 */
export function runInBackground(task: () => Promise<unknown>, label: string): void {
  const promise = Promise.resolve()
    .then(task)
    .catch((error) => console.error(`[leads] ${label} failed:`, error instanceof Error ? error.message : error));
  try {
    getCloudflareContext().ctx.waitUntil(promise);
  } catch {
    // Not on Workers (local dev, tests, next start): the promise simply keeps running.
  }
}
