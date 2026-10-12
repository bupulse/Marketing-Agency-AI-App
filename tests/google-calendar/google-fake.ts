import { vi } from "vitest";

// A stand-in for Google's OAuth and Calendar endpoints, installed as global fetch. Each test can override a route
// (by "METHOD path-prefix") and read back the calls that were made.

export type GoogleCall = { method: string; url: URL; body: unknown };
type Handler = (call: GoogleCall) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>;

export function googleFake() {
  const calls: GoogleCall[] = [];
  const routes = new Map<string, Handler>();
  const defaults: [string, Handler][] = [
    ["POST https://oauth2.googleapis.com/token", () => ({ json: { access_token: "ya29.access", expires_in: 3600 } })],
    ["POST https://oauth2.googleapis.com/revoke", () => ({ json: {} })],
    ["POST https://www.googleapis.com/calendar/v3/freeBusy", () => ({ json: { calendars: { primary: { busy: [] } } } })],
    ["POST https://www.googleapis.com/calendar/v3/calendars/primary/events", () => ({ json: { id: "evt1", status: "confirmed", hangoutLink: "https://meet.google.com/abc-defg-hij" } })],
    ["PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/", () => ({ json: { id: "evt1", status: "confirmed", hangoutLink: "https://meet.google.com/abc-defg-hij" } })],
    ["DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/", () => ({ status: 204 })],
  ];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === "string") {
      try {
        body = JSON.parse(raw);
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw));
      }
    }
    const call = { method, url, body };
    calls.push(call);
    const key = `${method} ${url.origin}${url.pathname}`;
    const handler = [...routes.entries(), ...defaults].find(([prefix]) => key.startsWith(prefix))?.[1];
    if (!handler) return new Response(JSON.stringify({ error: { message: `no fake for ${key}` } }), { status: 404 });
    const { status = 200, json } = await handler(call);
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(json ?? {}), { status, headers: { "content-type": "application/json" } });
  });
  return {
    calls,
    fetch: fetchMock,
    /** Overrides one endpoint (prefix of "METHOD https://host/path"). */
    on(prefix: string, handler: Handler) {
      routes.set(prefix, handler);
    },
    /** The calls to one endpoint prefix. */
    to(prefix: string) {
      return calls.filter((c) => `${c.method} ${c.url.origin}${c.url.pathname}`.startsWith(prefix));
    },
  };
}

/** An id_token as Google's token endpoint sends it (only the payload matters here). */
export function idToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.signature`;
}
