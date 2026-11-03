// Starts bupulse.com's production server on this Mac (port 3002, behind the Cloudflare tunnel "bupulse-prod").
// Production settings are read from Netlify at each start and passed to the server only in memory (never written to
// disk). CRON_SECRET is this Mac's own (Keychain "BuPulse production Mac cron"), so Netlify's old scheduled functions,
// which call https://bupulse.com with Netlify's secret, are refused once bupulse.com points here.
import { execSync, spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
const dir = `${process.env.HOME}/BuPulse-deploy`;
const logs = `${process.env.HOME}/bupulse-prod`;
const vars = JSON.parse(execSync("npx -y netlify-cli@27.12.0 env:list --json --context production", { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const env = { ...process.env };
for (const [k, v] of Object.entries(vars)) if (!/^(NETLIFY|URL$|DEPLOY_|BUILD_SHA|PORT$|PLATFORM$)/.test(k)) env[k] = v;
env.CRON_SECRET = execSync('security find-generic-password -s "BuPulse production Mac cron" -a bupulse -w', { encoding: "utf8" }).trim();
Object.assign(env, { NODE_ENV: "production", PLATFORM: "node", PORT: "3002" });
if (!/gknlsmvrzsyxinwmodtk/.test(env.DATABASE_URL || "")) { console.error("not the production database, stopping"); process.exit(1); }
const out = openSync(`${logs}/server.log`, "a");
const child = spawn("npx", ["next", "start", "-p", "3002"], { cwd: dir, env, detached: true, stdio: ["ignore", out, out] });
child.unref();
writeFileSync(`${logs}/server.pid`, String(child.pid));
console.log(`started bupulse.com server, npm pid ${child.pid}, port 3002`);
