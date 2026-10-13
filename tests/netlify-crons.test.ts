import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NETLIFY_PUBLISH_EVERY_MINUTES, publishTimingNote } from "@/lib/platform/limits";
import { CRON_JOBS, handleRunnerRequest, MAX_CURSOR_CALLS, RUNNER_BUDGET_MS, RUNNER_PATH, runJob, siteOrigin, startCron } from "@/netlify/lib/cron";

// worker.ts imports the OpenNext build output, so read it as text (as tests/worker-crons.test.ts does).
const worker = readFileSync("worker.ts", "utf8");
const schedules = Object.fromEntries([...worker.matchAll(/export const (\w+_CRON) = "([^"]+)"/g)].map((m) => [m[1], m[2]]));
const workerRoutes: Record<string, string> = Object.fromEntries(
  [...worker.matchAll(/\[(\w+_CRON)\]: "([^"]+)"/g)].map((m) => [schedules[m[1]], m[2]]),
);
const workerCursorRoutes = [...worker.matchAll(/runCursorCron\("([^"]+)"/g)].map((m) => m[1]);

const DIR = "netlify/functions";
const scheduled = readdirSync(DIR)
  .filter((f) => f.startsWith("cron-") && f.endsWith(".mts") && !f.includes("background"))
  .map((file) => {
    const text = readFileSync(`${DIR}/${file}`, "utf8");
    return { file, schedule: /schedule: "([^"]+)"/.exec(text)?.[1], path: /startCron\("([^"]+)"/.exec(text)?.[1] };
  });

describe("Netlify scheduled functions match the Cloudflare cron triggers", () => {
  // The one documented difference: the publisher runs every 5 minutes on Netlify (free plan credits), every minute on
  // Cloudflare. docs/DEPLOY_NETLIFY.md, lib/platform/limits.ts NETLIFY_PUBLISH_EVERY_MINUTES.
  const NETLIFY_ONLY: Record<string, string> = { "/api/cron/publish": `*/${NETLIFY_PUBLISH_EVERY_MINUTES} * * * *` };

  it("every Worker schedule has a Netlify function with the same schedule and route (publisher excepted)", () => {
    const netlify = Object.fromEntries(scheduled.map((s) => [s.path, s.schedule]));
    const expected = Object.fromEntries(Object.entries(workerRoutes).map(([schedule, path]) => [path, NETLIFY_ONLY[path] ?? schedule]));
    expect(netlify).toEqual(expected);
  });

  it("the publisher is every minute on Cloudflare and every 5 minutes on Netlify", () => {
    expect(schedules.PUBLISH_CRON).toBe("* * * * *");
    expect(scheduled.find((s) => s.path === "/api/cron/publish")?.schedule).toBe("*/5 * * * *");
  });

  it("the publisher claims every post due up to now, so a 5-minute gap skips nothing", () => {
    const engine = readFileSync("lib/publishing/engine.ts", "utf8");
    expect(engine).toContain('WHERE "status" = \'SCHEDULED\'::"PostStatus" AND "scheduledAt" <= ${now}');
  });

  it("each function is one schedule and one known job", () => {
    expect(new Set(scheduled.map((s) => s.schedule)).size).toBe(scheduled.length);
    for (const s of scheduled) expect(Object.hasOwn(CRON_JOBS, s.path!), s.file).toBe(true);
  });

  it("the cursor jobs are the ones worker.ts loops over (Autopilot included)", () => {
    const cursor = Object.values(CRON_JOBS).filter((j) => j.cursor).map((j) => j.path).sort();
    expect(cursor).toEqual([...new Set(workerCursorRoutes)].sort());
  });

  it("every job's route exists", () => {
    for (const path of Object.keys(CRON_JOBS)) expect(readFileSync(`app${path}/route.ts`, "utf8")).toContain("CRON_SECRET");
  });

  it("the runner is a background function", () => {
    expect(readdirSync(DIR)).toContain("cron-runner-background.mts");
    expect(RUNNER_PATH).toBe("/.netlify/functions/cron-runner-background");
  });
});

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("startCron (the scheduled function)", () => {
  it("posts the job to the background runner on this site with the secret", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    expect(await startCron("/api/cron/publish", { site: { url: "https://bupulse.netlify.app" } }, { CRON_SECRET: "s" }, fetchImpl)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://bupulse.netlify.app/.netlify/functions/cron-runner-background");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s");
    expect(JSON.parse(String(init.body))).toEqual({ path: "/api/cron/publish" });
  });

  it("does nothing without CRON_SECRET, and never throws", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("down"); });
    expect(await startCron("/api/cron/publish", undefined, {}, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await startCron("/api/cron/publish", undefined, { CRON_SECRET: "s" }, fetchImpl)).toBe(false);
  });

  it("calls its own site first: Netlify's context, then URL, then NEXT_PUBLIC_SITE_URL", () => {
    expect(siteOrigin({ site: { url: "https://a.netlify.app/" } }, { URL: "https://b.example", NEXT_PUBLIC_SITE_URL: "https://c.example" })).toBe("https://a.netlify.app");
    expect(siteOrigin(undefined, { URL: "https://b.example", NEXT_PUBLIC_SITE_URL: "https://c.example" })).toBe("https://b.example");
    expect(siteOrigin({ site: null }, { NEXT_PUBLIC_SITE_URL: "https://c.example/x" })).toBe("https://c.example");
    expect(siteOrigin(undefined, {})).toBe("https://bupulse.com");
  });
});

const runnerRequest = (body: unknown, auth = "Bearer s", method = "POST") =>
  new Request("https://bupulse.netlify.app/.netlify/functions/cron-runner-background", { method, headers: { authorization: auth }, body: method === "POST" ? JSON.stringify(body) : undefined });

describe("the background runner", () => {
  const ctx = { site: { url: "https://bupulse.netlify.app" } };

  it("refuses a wrong secret, a GET, an unknown job and a missing secret", async () => {
    const fetchImpl = vi.fn(async () => ok({}));
    expect((await handleRunnerRequest(runnerRequest({ path: "/api/cron/publish" }, "Bearer x"), ctx, { CRON_SECRET: "s" }, fetchImpl)).status).toBe(401);
    expect((await handleRunnerRequest(runnerRequest(null, "Bearer s", "GET"), ctx, { CRON_SECRET: "s" }, fetchImpl)).status).toBe(401);
    expect((await handleRunnerRequest(runnerRequest({ path: "/api/cron/purge-everything" }), ctx, { CRON_SECRET: "s" }, fetchImpl)).status).toBe(400);
    expect((await handleRunnerRequest(runnerRequest({ path: "https://evil.example/api/cron/publish" }), ctx, { CRON_SECRET: "s" }, fetchImpl)).status).toBe(400);
    expect((await handleRunnerRequest(runnerRequest({ path: "__proto__" }), ctx, { CRON_SECRET: "s" }, fetchImpl)).status).toBe(400);
    expect((await handleRunnerRequest(runnerRequest({ path: "/api/cron/publish" }), ctx, {}, fetchImpl)).status).toBe(500);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls a single-call route once with the bearer secret", async () => {
    const fetchImpl = vi.fn(async () => ok({ claimed: 0 }));
    expect(await handleRunnerRequest(runnerRequest({ path: "/api/cron/publish" }), ctx, { CRON_SECRET: "s" }, fetchImpl)).toEqual({ status: 200, calls: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://bupulse.netlify.app/api/cron/publish");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s");
  });

  it("follows nextCursor until it is null", async () => {
    const answers = [{ nextCursor: "b1" }, { nextCursor: "b 2" }, { nextCursor: null }];
    const fetchImpl = vi.fn(async () => ok(answers.shift()));
    expect(await runJob(CRON_JOBS["/api/cron/autopilot"], "https://x.example", "s", fetchImpl)).toBe(3);
    expect(fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      "https://x.example/api/cron/autopilot",
      "https://x.example/api/cron/autopilot?cursor=b1",
      "https://x.example/api/cron/autopilot?cursor=b+2",
    ]);
  });

  it("follows the content summary's keyset cursor on both hosts", async () => {
    expect(CRON_JOBS["/api/cron/content-summary"].cursor).toBe(true);
    expect(workerCursorRoutes).toContain("/api/cron/content-summary");
    expect(worker).toMatch(/CONTENT_SUMMARY_CRON\) return ctx\.waitUntil\(runCursorCron\("\/api\/cron\/content-summary"/);
    const answers = [{ nextCursor: "2026-10-11T07:00:00.000Z|b5" }, { nextCursor: null }];
    const fetchImpl = vi.fn(async () => ok(answers.shift()));
    expect(await runJob(CRON_JOBS["/api/cron/content-summary"], "https://x.example", "s", fetchImpl)).toBe(2);
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe("https://x.example/api/cron/content-summary?cursor=2026-10-11T07%3A00%3A00.000Z%7Cb5");
  });

  it("stops on an error answer or a body that is not JSON", async () => {
    expect(await runJob(CRON_JOBS["/api/cron/store-sync"], "https://x.example", "s", vi.fn(async () => ok({ error: "x" }, 500)))).toBe(1);
    expect(await runJob(CRON_JOBS["/api/cron/store-sync"], "https://x.example", "s", vi.fn(async () => new Response("<html>")))).toBe(1);
    expect(await runJob(CRON_JOBS["/api/cron/store-sync"], "https://x.example", "s", vi.fn(async () => { throw new Error("timeout"); }))).toBe(1);
  });

  it("stops after 40 calls, or when the 13-minute budget is used", async () => {
    const always = vi.fn(async () => ok({ nextCursor: "again" }));
    expect(await runJob(CRON_JOBS["/api/cron/momo-renewals"], "https://x.example", "s", always)).toBe(MAX_CURSOR_CALLS);
    let clock = 0;
    const slow = vi.fn(async () => {
      clock += 5 * 60 * 1000;
      return ok({ nextCursor: "again" });
    });
    const calls = await runJob(CRON_JOBS["/api/cron/momo-renewals"], "https://x.example", "s", slow, () => clock);
    expect(calls).toBe(Math.floor(RUNNER_BUDGET_MS / (5 * 60 * 1000)) + 1);
  });
});

describe("the publishing delay note", () => {
  it("is shown on Netlify only", () => {
    expect(publishTimingNote("netlify")).toBe("Posts go out within 5 minutes of the scheduled time.");
    expect(publishTimingNote("cloudflare")).toBeNull();
    expect(publishTimingNote("node")).toBeNull();
  });
});
