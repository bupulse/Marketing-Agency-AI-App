// The production PC's render worker (docs/SELF_HOST.md, "Videos made on the PC"): the video robot, run beside the
// server instead of every 15 minutes on GitHub, so a video planned by Create post, Daily posts or Autopilot is made
// within a minute or two, even when nobody has the page open.
//
//   node scripts/self-host/windows/server.mjs videos     (how the job loop starts it: the robot secret in memory only)
//   node scripts/video-robot/pc-worker.mjs               (the same, with ROBOT_APP_URL and VIDEO_ROBOT_SECRET set)
//
// It asks the local server every ROBOT_POLL_SECONDS (default 10) how many videos wait (a quiet count: no heartbeat
// row each time) and, when some do, makes them exactly as the GitHub robot does: the same claim (render lease, quotas,
// voice-over made on the server), the same browser renderer in headless Edge or Chrome (voice-over and library music
// mixed in by lib/voice/mix.ts), the same upload and confirm. The GitHub robot stays on as the fallback; the lease
// means the two never make the same video. Every 15 minutes it leaves the idle heartbeat (Admin -> Services).
// It stops after ROBOT_WORKER_MINUTES (default 60) so the job loop starts a fresh process (new code after an update,
// no slow leak). It never throws: a failed run waits and tries again, longer each time (up to 5 minutes).
import { pathToFileURL } from "node:url";
import { createLogger } from "./log.mjs";
import { peek, run, settings } from "./robot.mjs";

const log = createLogger((line) => console.log(line.replace("[video-robot]", "[render-worker]")));

/** @param {Record<string, string | undefined>} env */
export function workerSettings(env = process.env) {
  const int = (value, fallback, min, max) => {
    const n = Number.parseInt(value ?? "", 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    // Edge first: it comes with Windows 10, so the PC needs nothing installed; Google Chrome when Edge is missing.
    robot: settings({ ROBOT_CHROME_CHANNEL: "msedge,chrome", ROBOT_BUDGET_MS: String(10 * 60_000), ...env, ROBOT_RUNNER: "pc" }),
    pollMs: int(env.ROBOT_POLL_SECONDS, 10, 3, 300) * 1000,
    lifetimeMs: int(env.ROBOT_WORKER_MINUTES, 60, 1, 24 * 60) * 60_000,
    heartbeatMs: 15 * 60_000,
  };
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The loop. `deps` are replaced by the tests: peek(config, opts) → number, run(config, prepared) → counts,
 * build() → the page bundle, sleep(ms), now().
 */
export async function workerLoop(config, deps = {}) {
  const { peek: count = peek, run: render = run, build = async () => (await import("./build-page.mjs")).buildPage(), sleep = realSleep, now = Date.now } = deps;
  const started = now();
  let prepared = null;
  let lastHeartbeat = -Infinity;
  let backoffMs = 0;
  const totals = { runs: 0, made: 0, failed: 0, errors: 0 };
  log("worker_started");
  while (now() - started < config.lifetimeMs) {
    try {
      // The idle heartbeat every 15 minutes (a normal peek records it when nothing waits); quiet in between.
      const heartbeat = now() - lastHeartbeat >= config.heartbeatMs;
      const waiting = await count(config.robot, { quiet: !heartbeat });
      if (heartbeat) lastHeartbeat = now();
      backoffMs = 0;
      if (waiting > 0) {
        // The renderer's page is bundled once per process (a few seconds), then reused for every run.
        prepared ??= await build();
        const counts = await render(config.robot, prepared);
        totals.runs += 1;
        totals.made += counts?.made ?? 0;
        totals.failed += counts?.failed ?? 0;
        // Nothing could be claimed (caps, quotas, all leased by GitHub's robot): wait like an idle round.
        if ((counts?.claimed ?? 0) > 0) continue;
      }
    } catch {
      totals.errors += 1;
      backoffMs = Math.min(5 * 60_000, backoffMs ? backoffMs * 2 : 30_000);
      log(prepared ? "worker_run_failed" : "worker_waiting_app");
      await sleep(backoffMs);
      continue;
    }
    await sleep(config.pollMs);
  }
  log("worker_stopping");
  return totals;
}

async function main() {
  const config = workerSettings();
  if (!config.robot.configured) {
    log("not_configured");
    // Idle for a while so the job loop does not start it again every few seconds.
    await realSleep(10 * 60_000);
    return;
  }
  await workerLoop(config);
}

// pathToFileURL: on Windows the script's URL is file:///D:/..., not file:// + the path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
