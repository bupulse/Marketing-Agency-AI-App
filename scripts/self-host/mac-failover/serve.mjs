// The Mac's standby bupulse.com server for automatic failover (watch.mjs): next start on 127.0.0.1:3002 in
// ~/BuPulse-deploy, in the foreground (launchd keeps it running and starts it after a restart). Production settings are
// read from Netlify at each start and passed only in memory. CRON_SECRET is this Mac's own (Keychain "BuPulse
// production Mac cron"), different from the PC's, so no scheduled job ever runs here: nothing is posted twice.
import { execSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const PROD_DB = /gknlsmvrzsyxinwmodtk/;
const dir = join(homedir(), "BuPulse-deploy");
let vars = {};
for (const pkg of ["netlify-cli@27.19.0", "netlify-cli@27.12.0", "netlify-cli@latest"]) {
  try {
    vars = JSON.parse(execSync(`npx -y ${pkg} env:list --json --context production`, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    vars = {};
  }
  if (PROD_DB.test(vars.DATABASE_URL || "")) break;
}
if (!PROD_DB.test(vars.DATABASE_URL || "")) {
  console.error("not the production database, stopping");
  process.exit(1);
}
const env = { ...process.env };
for (const [k, v] of Object.entries(vars)) if (!/^(NETLIFY|URL$|DEPLOY_|BUILD_SHA|PORT$|PLATFORM$)/.test(k)) env[k] = v;
env.CRON_SECRET = execSync('security find-generic-password -s "BuPulse production Mac cron" -a bupulse -w', { encoding: "utf8" }).trim();
Object.assign(env, { NODE_ENV: "production", PLATFORM: "node", PORT: "3002" });
const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", "3002"], { cwd: dir, env, stdio: "inherit" });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 1));
