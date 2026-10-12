import "server-only";
import { waitUntil } from "@/lib/platform/background";

/**
 * Runs work after the response without making the visitor wait: the host's waitUntil on Cloudflare Workers and
 * Netlify (lib/platform/background.ts), a detached promise in Node. A failure is logged, never thrown.
 */
export function runInBackground(task: () => Promise<unknown>, label: string): void {
  const promise = Promise.resolve()
    .then(task)
    .catch((error) => console.error(`[leads] ${label} failed:`, error instanceof Error ? error.message : error));
  // Without a host (local dev, tests, next start) the promise simply keeps running.
  waitUntil(promise);
}
