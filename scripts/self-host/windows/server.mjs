// bupulse.com's production server on the home Windows PC (port 3002 on 127.0.0.1, behind the Cloudflare tunnel
// "bupulse-prod"). The Windows twin of scripts/self-host/start-server.mjs (docs/SELF_HOST.md).
//
//   node scripts/self-host/windows/server.mjs build   prisma generate + next build with the production settings
//   node scripts/self-host/windows/server.mjs start   next start (stays in the foreground; Task Scheduler runs it)
//   node scripts/self-host/windows/server.mjs videos  the render worker (scripts/video-robot/pc-worker.mjs), started by
//                                                      the job loop: makes pending videos right away (docs/SELF_HOST.md)
//
// Production settings are read from Netlify at each run (the folder is linked with `netlify link`) and passed to the
// child only in memory, never written to disk. CRON_SECRET is this PC's own, kept in %USERPROFILE%\bupulse-prod\
// cron-secret.txt (readable by this Windows user only, written by install.ps1), so Netlify's old scheduled functions
// and the Mac's loop are refused here.
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { join, resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "build" && mode !== "start" && mode !== "tool" && mode !== "videos") {
  console.error("usage: node scripts/self-host/windows/server.mjs build|start|videos|tool <name> [args]");
  process.exit(1);
}
// `tool <name>`: one of scripts/self-host/tools/<name>.mjs, run with the same production settings (in memory).
const tool = mode === "tool" ? process.argv[3] : null;
if (mode === "tool" && !/^[a-z0-9-]+$/.test(tool ?? "")) {
  console.error("usage: node scripts/self-host/windows/server.mjs tool <name> [args] (a file in scripts/self-host/tools)");
  process.exit(1);
}
// The folder's real letter case (C:\Users\WECPC015\BuPulse), whatever case the window typed: started from a lowercase
// path (Chrome Remote Desktop drops Shift), Next.js loaded its modules twice and every build failed with "Invariant:
// Expected workStore to be initialized" (12 November 2026, the site was down for hours).
const dir = realpathSync.native(resolve(import.meta.dirname, "../../.."));
const logs = join(homedir(), "bupulse-prod");
mkdirSync(logs, { recursive: true });

const vars = JSON.parse(execSync("npx -y netlify-cli@27.12.0 env:list --json --context production", { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true }));
const env = { ...process.env };
for (const [k, v] of Object.entries(vars)) if (!/^(NETLIFY|URL$|DEPLOY_|BUILD_SHA|PORT$|PLATFORM$)/.test(k)) env[k] = v;
env.CRON_SECRET = readFileSync(join(logs, "cron-secret.txt"), "utf8").trim();
Object.assign(env, { NODE_ENV: "production", PLATFORM: "node", PORT: "3002" });
if (!/gknlsmvrzsyxinwmodtk/.test(env.DATABASE_URL || "")) {
  console.error("not the production database, stopping");
  process.exit(1);
}

// The PC's render worker sits beside this server: the screens say a pending video is made within minutes (not at the
// GitHub robot's next 15-minute run). lib/visuals/robot.ts serverRenderOn.
env.BUPULSE_SERVER_RENDER = "1";
// The robot secret: Netlify's VIDEO_ROBOT_SECRET (shared with the GitHub robot, the fallback), else this PC's own
// %USERPROFILE%\bupulse-prod\robot-secret.txt (then only the PC makes videos automatically).
if (!env.VIDEO_ROBOT_SECRET && existsSync(join(logs, "robot-secret.txt"))) env.VIDEO_ROBOT_SECRET = readFileSync(join(logs, "robot-secret.txt"), "utf8").trim();

// The build and tools print to the window they run in; the server (run by Task Scheduler, no window) writes server.log.
const run = (command) => {
  const stdio = mode !== "start" ? "inherit" : ["ignore", ...Array(2).fill(openSync(join(logs, "server.log"), "a"))];
  const result = spawnSync(command, { cwd: dir, env, shell: true, stdio });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (mode === "build") {
  // Room for the bundler (Node's default heap ran out on the desktop), and no type check here (checked before pushing).
  const heapMb = Math.max(3072, Math.min(8192, Math.floor((totalmem() / 1048576) * 0.6)));
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --max-old-space-size=${heapMb}`.trim();
  env.BUPULSE_SKIP_TYPECHECK = "1";
}

if (mode === "videos") {
  // The render worker gets this PC's own environment plus only what it needs: the local server's address and the
  // robot secret (in memory). Not the database or any other production key. Its lines go to the job loop's videos.log.
  if (!env.VIDEO_ROBOT_SECRET) {
    console.error("VIDEO_ROBOT_SECRET is not in the production settings: the render worker cannot start (docs/SELF_HOST.md)");
    process.exit(3);
  }
  const workerEnv = { ...process.env, ROBOT_APP_URL: "http://127.0.0.1:3002", VIDEO_ROBOT_SECRET: env.VIDEO_ROBOT_SECRET, NODE_ENV: "production" };
  const result = spawnSync("node scripts/video-robot/pc-worker.mjs", { cwd: dir, env: workerEnv, shell: true, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (mode === "tool") {
  const quoted = process.argv.slice(4).map((a) => (/^[A-Za-z0-9_.=-]+$/.test(a) ? a : JSON.stringify(a))).join(" ");
  run(`node scripts/self-host/tools/${tool}.mjs ${quoted}`.trim());
} else if (mode === "build") {
  // The database first: new tables and columns of this version (prisma/migrations; additive by the repo's rule), the job
  // the Netlify deploy workflow did before (.github/workflows/deploy.yml). Uses DIRECT_URL from the production settings.
  run("npx prisma migrate deploy --config prisma7.config.ts");
  run("npx prisma generate --config prisma7.config.ts");
  run("npm run build");
  console.log("build done");
} else {
  // Only the tunnel on this PC talks to the server, so it listens on 127.0.0.1 (no Windows firewall prompt).
  run("npx next start -H 127.0.0.1 -p 3002");
}
