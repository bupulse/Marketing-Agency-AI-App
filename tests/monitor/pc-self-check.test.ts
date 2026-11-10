import { describe, expect, it } from "vitest";
import { lastWasDown, selfCheck } from "@/scripts/monitor/pc-self-check.mjs";

type Call = { url: string; init?: RequestInit };

function fakeFetch(siteUp: boolean, calls: Call[]) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/api/monitor/uptime")) return new Response("{}", { status: 200 });
    if (url.endsWith("/api/status")) return siteUp ? new Response(JSON.stringify({ status: "ok", databaseMs: 20, version: "1.4.2" }), { status: 200 }) : new Response("bad gateway", { status: 502 });
    return new Response("<html></html>", { status: siteUp ? 200 : 502 });
  };
}

describe("the server PC's own 5-minute check", () => {
  it("reads the state file safely", () => {
    expect(lastWasDown('{"down":true}')).toBe(true);
    expect(lastWasDown('{"down":false}')).toBe(false);
    expect(lastWasDown("")).toBe(false);
    expect(lastWasDown("not json")).toBe(false);
  });

  it("times the public site and records on the local server with the PC's secret; afterFailure from the state", async () => {
    const calls: Call[] = [];
    const out = await selfCheck({ site: "https://bupulse.com", local: "http://127.0.0.1:3002", secret: "pc-secret", previousDown: true }, { fetchImpl: fakeFetch(true, calls) as never });
    expect(out.down).toBe(false);
    expect(calls.slice(0, 4).map((c) => c.url)).toEqual(["https://bupulse.com/api/status", "https://bupulse.com/", "https://bupulse.com/pricing", "https://bupulse.com/login"]);
    const post = calls.find((c) => c.url === "http://127.0.0.1:3002/api/monitor/uptime");
    expect(post?.init?.headers).toMatchObject({ authorization: "Bearer pc-secret" });
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ ok: true, afterFailure: true, databaseMs: 20, retried: false });
    expect(out.line).toMatch(/^UP: \/api\/status 200 /);
    expect(out.line).toContain("Check recorded.");
    expect(out.line).not.toContain("pc-secret");
  });

  it("down: tries again a minute later, records the failed check, says DOWN", async () => {
    const calls: Call[] = [];
    let waited = 0;
    const out = await selfCheck(
      { site: "https://bupulse.com", local: "http://127.0.0.1:3002", secret: "s", previousDown: false },
      {
        fetchImpl: fakeFetch(false, calls) as never,
        wait: async (ms: number) => {
          waited = ms;
        },
      },
    );
    expect(out.down).toBe(true);
    expect(waited).toBe(60_000);
    const post = calls.find((c) => c.url.endsWith("/api/monitor/uptime"));
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ ok: false, retried: true, afterFailure: false });
    expect(out.line).toMatch(/^DOWN: /);
  });
});
