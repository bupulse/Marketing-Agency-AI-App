// Puts a new production secret into Netlify's production settings straight from the Mac clipboard, checking that it
// works first, without ever printing it (17 November 2026: secrets rotated after malware ran on the office PC).
// Run from a folder linked to the Netlify site (~/BuPulse-deploy), after the owner copied the new value:
//
//   node scripts/self-host/tools/set-prod-secret.mjs db-password      new Supabase database password
//                                                                    -> DATABASE_URL and DIRECT_URL (password replaced)
//   node scripts/self-host/tools/set-prod-secret.mjs supabase-secret  new Supabase secret key (sb_secret_...)
//                                                                    -> SUPABASE_SECRET_KEY
//   node scripts/self-host/tools/set-prod-secret.mjs random KEY       a fresh random value made here -> KEY
//   node scripts/self-host/tools/set-prod-secret.mjs clip KEY         a provider key from the clipboard (Gemini, ElevenLabs checked) -> KEY
//
// Nothing is written to disk. Values go to the Netlify CLI as arguments (no shell), so they never reach a log.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

const [kind, key] = process.argv.slice(2);
const cwd = process.cwd();
const CLIS = ["netlify-cli@27.12.0", "netlify-cli@latest"];

function netlify(args) {
  let last;
  for (const pkg of CLIS) {
    try {
      return execFileSync("npx", ["-y", pkg, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { last = e; }
  }
  throw new Error(`netlify ${args[0]} failed: ${String(last?.stderr || last?.message).slice(0, 300).replace(/[A-Za-z0-9_\-]{24,}/g, "<hidden>")}`);
}

function current() {
  const vars = JSON.parse(netlify(["env:list", "--json", "--context", "production"]));
  if (!/gknlsmvrzsyxinwmodtk/.test(vars.DATABASE_URL || "")) throw new Error("this folder is not linked to the production site");
  return vars;
}

function setVar(name, value) {
  netlify(["env:set", name, value, "--context", "production", "--force"]);
  console.log(`set ${name} (length ${value.length})`);
}

function clipboard() {
  const v = execFileSync("pbpaste", { encoding: "utf8" }).trim();
  if (!v || /\s/.test(v)) throw new Error("the clipboard is empty or has spaces: copy the new value again");
  return v;
}

async function testDb(url) {
  const require = createRequire(join(cwd, "package.json"));
  const { Client } = require("pg");
  // Same connection settings as the app (the URL decides SSL), so "works here" means "works for the server".
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 20_000 });
  await c.connect();
  await c.query("select 1");
  await c.end();
}

if (kind === "db-password") {
  const pw = clipboard();
  if (pw.length < 16) throw new Error("that password is shorter than 16 characters: use Supabase's Generate button");
  const vars = current();
  const out = {};
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    const u = new URL(vars[name]);
    u.password = encodeURIComponent(pw);
    out[name] = u.toString();
    // SKIP_TEST=1: Supabase's pooler blocks every login for a few minutes ("ECIRCUITBREAKER too many authentication
    // failures") once the old password has been retried by running servers, which happens right after a reset.
    if (process.env.SKIP_TEST === "1") continue;
    await testDb(out[name]);
    console.log(`${name}: the new password works`);
  }
  for (const [name, value] of Object.entries(out)) setVar(name, value);
} else if (kind === "supabase-secret") {
  const sk = clipboard();
  if (!sk.startsWith("sb_secret_")) throw new Error("the clipboard does not hold a Supabase secret key (sb_secret_...)");
  const vars = current();
  const res = await fetch(`${vars.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1`, { headers: { apikey: sk, Authorization: `Bearer ${sk}` } });
  if (!res.ok) throw new Error(`Supabase refused the new key (HTTP ${res.status})`);
  console.log("SUPABASE_SECRET_KEY: the new key works");
  setVar("SUPABASE_SECRET_KEY", sk);
} else if (kind === "clip" && /^[A-Z][A-Z0-9_]+$/.test(key || "")) {
  // A provider's new API key from the clipboard. Known providers are checked first with a read-only call.
  const v = clipboard();
  current();
  const checks = {
    GEMINI_API_KEY: () => fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": v } }),
    ELEVENLABS_API_KEY: () => fetch("https://api.elevenlabs.io/v1/models", { headers: { "xi-api-key": v } }),
  };
  if (checks[key]) {
    const res = await checks[key]();
    if (!res.ok) throw new Error(`the provider refused the new ${key} (HTTP ${res.status})`);
    console.log(`${key}: the new key works`);
  }
  setVar(key, v);
} else if (kind === "random" && /^[A-Z][A-Z0-9_]+$/.test(key || "")) {
  current();
  setVar(key, randomBytes(36).toString("base64url"));
} else {
  console.error("usage: set-prod-secret.mjs db-password | supabase-secret | clip KEY | random KEY");
  process.exit(2);
}
console.log("done: restart the PC server (refresh-env) and the Mac standby to use it");
