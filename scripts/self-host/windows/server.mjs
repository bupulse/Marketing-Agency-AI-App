// bupulse.com's production server on the home Windows PC (port 3002 on 127.0.0.1, behind the Cloudflare tunnel
// "bupulse-prod"). The Windows twin of scripts/self-host/start-server.mjs (docs/SELF_HOST.md).
//
//   node scripts/self-host/windows/server.mjs build   prisma generate + next build with the production settings
//   node scripts/self-host/windows/server.mjs start   next start (stays in the foreground; Task Scheduler runs it)
//
// Production settings are read from Netlify at each run (the folder is linked with `netlify link`) and passed to the
// child only in memory, never written to disk. CRON_SECRET is this PC's own, kept in %USERPROFILE%\bupulse-prod\
// cron-secret.txt (readable by this Windows user only, written by install.ps1), so Netlify's old scheduled functions
// and the Mac's loop are refused here.
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "build" && mode !== "start") {
  console.error("usage: node scripts/self-host/windows/server.mjs build|start");
  process.exit(1);
}
const dir = resolve(import.meta.dirname, "../../..");
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

const run = (command) => {
  const out = openSync(join(logs, mode === "build" ? "build.log" : "server.log"), "a");
  const result = spawnSync(command, { cwd: dir, env, shell: true, stdio: mode === "build" ? "inherit" : ["ignore", out, out] });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (mode === "build") {
  run("npx prisma generate --config prisma7.config.ts");
  run("npm run build");
  console.log("build done");
} else {
  // Only the tunnel on this PC talks to the server, so it listens on 127.0.0.1 (no Windows firewall prompt).
  run("npx next start -H 127.0.0.1 -p 3002");
}
