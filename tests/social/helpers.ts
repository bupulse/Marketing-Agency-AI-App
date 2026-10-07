import { vi } from "vitest";

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

/** Replaces global fetch with a mock that answers from a queue, in order. */
export function mockFetch(...responses: Response[]) {
  const fn = vi.fn();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function callAt(fn: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fn.mock.calls[index] as [string, RequestInit | undefined];
  return { url, init: init ?? {}, headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === "string" ? init.body : undefined };
}
