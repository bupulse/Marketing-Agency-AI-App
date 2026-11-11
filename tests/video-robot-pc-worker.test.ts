import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { settings } from "../scripts/video-robot/robot.mjs";
import { workerLoop, workerSettings } from "../scripts/video-robot/pc-worker.mjs";

// The production PC's render worker (docs/SELF_HOST.md, "Videos made on the PC"): polls quietly, renders when videos
// wait, leaves an idle heartbeat every 15 minutes, backs off when the app is down, and stops after its lifetime.

function clock() {
  let t = 0;
  return { now: () => t, sleep: vi.fn(async (ms: number) => void (t += ms)), advance: (ms: number) => (t += ms) };
}

describe("render worker settings", () => {
  it("tries Edge then Chrome, runs as the PC, polls every 10 s for an hour", () => {
    const c = workerSettings({ ROBOT_APP_URL: "http://127.0.0.1:3002", VIDEO_ROBOT_SECRET: "s" });
    expect(c.robot.configured).toBe(true);
    expect(c.robot.channels).toEqual(["msedge", "chrome"]);
    expect(c.robot.runner).toBe("pc");
    expect(c.robot.budgetMs).toBe(10 * 60_000);
    expect(c.pollMs).toBe(10_000);
    expect(c.lifetimeMs).toBe(60 * 60_000);
    expect(workerSettings({ ROBOT_POLL_SECONDS: "1", ROBOT_WORKER_MINUTES: "0" }).pollMs).toBe(3000);
  });

  it("the GitHub robot keeps Chrome and reports as github; unknown channels are dropped", () => {
    expect(settings({}).channels).toEqual(["chrome"]);
    expect(settings({}).runner).toBe("github");
    expect(settings({ ROBOT_CHROME_CHANNEL: "msedge, evil;rm -rf, chrome" }).channels).toEqual(["msedge", "chrome"]);
  });
});

describe("render worker loop", () => {
  const config = { ...workerSettings({ ROBOT_APP_URL: "http://127.0.0.1:3002", VIDEO_ROBOT_SECRET: "s" }), lifetimeMs: 60_000 };

  it("peeks quietly while idle, with one heartbeat peek at the start, and never renders", async () => {
    const c = clock();
    const peek = vi.fn<(config: unknown, opts?: { quiet: boolean }) => Promise<number>>(async () => 0);
    const run = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await workerLoop(config, { peek, run, build: async () => ({ html: "", script: "" }), sleep: c.sleep, now: c.now });
    log.mockRestore();
    expect(run).not.toHaveBeenCalled();
    expect(peek.mock.calls.length).toBe(6);
    expect(peek.mock.calls[0][1]).toEqual({ quiet: false });
    expect(peek.mock.calls.slice(1).every((call) => call[1]?.quiet === true)).toBe(true);
  });

  it("renders as soon as videos wait, builds the page once, and asks again right after a run that claimed some", async () => {
    const c = clock();
    const waiting = [2, 1, 0, 0];
    const peek = vi.fn(async () => waiting.shift() ?? 0);
    const build = vi.fn(async () => ({ html: "<p>", script: "x" }));
    const run = vi.fn(async () => {
      c.advance(20_000);
      return { claimed: 1, made: 1, failed: 0 };
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const totals = await workerLoop(config, { peek, run, build, sleep: c.sleep, now: c.now });
    log.mockRestore();
    expect(run).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toEqual([config.robot, { html: "<p>", script: "x" }]);
    expect(totals.made).toBe(2);
  });

  it("backs off (30 s, 60 s, ...) when the app does not answer, and never throws", async () => {
    const c = clock();
    const peek = vi.fn(async () => Promise.reject(new Error("status 0")));
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(l));
    const totals = await workerLoop({ ...config, lifetimeMs: 200_000 }, { peek, run: vi.fn(), sleep: c.sleep, now: c.now });
    log.mockRestore();
    expect(c.sleep.mock.calls.map((x) => x[0])).toEqual([30_000, 60_000, 120_000]);
    expect(totals.errors).toBe(3);
    expect(lines.some((l) => l.includes("[render-worker] The app does not answer yet"))).toBe(true);
    expect(lines.at(-1)).toContain("Render worker stopping");
  });

  it("the job loop runs it on its own thread and never lets it stop the tick", () => {
    const loop = readFileSync("scripts/self-host/windows/cron-loop.ps1", "utf8");
    expect(loop).toContain("server.mjs");
    expect(loop).toMatch(/\$videosRunner = \[PowerShell\]::Create\(\)/);
    expect(loop.indexOf("$videosRunner")).toBeLessThan(loop.lastIndexOf("/api/cron/tick"));
    const server = readFileSync("scripts/self-host/windows/server.mjs", "utf8");
    // Only the robot secret and the local address reach the worker, not the production settings.
    expect(server).toMatch(/workerEnv = \{ \.\.\.process\.env, ROBOT_APP_URL: "http:\/\/127\.0\.0\.1:3002", VIDEO_ROBOT_SECRET: env\.VIDEO_ROBOT_SECRET/);
  });
});
