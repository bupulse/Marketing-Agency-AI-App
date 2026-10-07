// The Workers Cache API (`caches.default`), shared across isolates and requests. Not present in
// Node (tests, `next dev`), where every helper here quietly does nothing.
const ORIGIN = "https://bupulse-cache.internal";

function cache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

export async function edgeGet(key: string): Promise<ArrayBuffer | null> {
  try {
    const hit = await cache()?.match(new Request(`${ORIGIN}/${key}`));
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Stores bytes for `maxAgeSeconds`. Failures are ignored: the cache is only an optimisation. */
export async function edgePut(key: string, bytes: ArrayBuffer, contentType: string, maxAgeSeconds: number): Promise<void> {
  try {
    await cache()?.put(new Request(`${ORIGIN}/${key}`), new Response(bytes.slice(0), { headers: { "Content-Type": contentType, "Cache-Control": `public, max-age=${maxAgeSeconds}` } }));
  } catch {}
}

/** Hex SHA-256 of the parts, a stable cache key. */
export async function hashKey(parts: unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
