#!/usr/bin/env node
// Checks the production environment variables before a deploy (docs/DEPLOY.md, docs/DEPLOY_NETLIFY.md,
// docs/RELEASE_2.0.md). Prints
// variable NAMES and problems only, never a value. Exit code 1 when something required is missing or wrong.
//
//   node scripts/check-env.mjs --build     the build-time values in this process (the deploy workflow's env:
//                                          NEXT_PUBLIC_*, PLATFORM, and DIRECT_URL for the migrations)
//   node scripts/check-env.mjs --cloudflare  the Worker's secrets set in Cloudflare (names, read with
//                                          CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; values cannot be read) and
//                                          the Hyperdrive binding in wrangler.jsonc (it replaces DATABASE_URL there)
//   node scripts/check-env.mjs --netlify   the runtime values set in Netlify (names, read with NETLIFY_AUTH_TOKEN
//                                          and NETLIFY_SITE_ID; secret values cannot be read, so only presence)
//   node scripts/check-env.mjs --runtime   the runtime values in this process (a local .env: node --env-file=.env)

/** Needed by the build (GitHub variables in the deploy workflow) and by the migrations. */
export const BUILD_REQUIRED = ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DIRECT_URL"];

/** Needed at runtime: the site does not work (or is unsafe) without them. */
export const RUNTIME_REQUIRED = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "SUPABASE_SECRET_KEY",
  "ENCRYPTION_KEY",
  "API_KEY_PEPPER",
  "CRON_SECRET",
  "ADMIN_EMAILS",
  "AI_TEXT_PROVIDER",
  "RESEND_API_KEY",
];

/** Features that switch off quietly without them: a warning, not a failure. */
export const RUNTIME_RECOMMENDED = [
  ["RESEND_FROM", "emails come from the default sender"],
  ["AI_MONTHLY_BUDGET_USD", "the platform AI cap uses its default"],
  ["AI_COMPANY_MONTHLY_USD", "each company's AI allowance uses its default (3 USD)"],
  ["WIDGET_AI_SHARE", "the website chat may use half of a company's AI allowance (default 0.5)"],
  ["MEDIA_PLATFORM_MAX_BYTES", "the shared storage guard uses 900 MB"],
  ["MEDIA_COMPANY_VIDEO_MAX_BYTES", "each company's Gallery videos stop at 100 MB"],
  ["ELEVENLABS_API_KEY", "voiceovers and Generate a track are off"],
  ["VIDEO_ROBOT_SECRET", "the video robot is off: owners make videos in their browser"],
  ["NEXT_PUBLIC_WHATSAPP_NUMBER", "no Chat on WhatsApp button"],
  ["TURNSTILE_SITE_KEY", "sign-up and chat rely on rate limits only"],
  ["TURNSTILE_SECRET_KEY", "sign-up and chat rely on rate limits only"],
  ["GOOGLE_CALENDAR_CLIENT_ID", "demo bookings use a meeting link and .ics only"],
  ["VAPID_PUBLIC_KEY", "phone and browser alerts for new leads are off (the switch is hidden)"],
  ["VAPID_PRIVATE_KEY", "phone and browser alerts for new leads are off (the switch is hidden)"],
  ["VAPID_SUBJECT", "phone and browser alerts for new leads are off (the switch is hidden)"],
  ["GITHUB_REPO", "Admin, Settings, Updates shows Not connected"],
  ["GITHUB_TOKEN", "Admin, Settings, Updates shows Not connected"],
];

/** Development-only switches that must never be on in production. */
export const PRODUCTION_FORBIDDEN = ["ANALYTICS_DEV_COUNTRY", "REGION_OVERRIDE"];
/** Test-machine settings (the test.bupulse.com tunnel) that must be EMPTY in production: a warning, so the owner removes them. */
export const PRODUCTION_TEST_ONLY = [
  ["AUTH_EXTRA_ORIGINS", "extra sign-in origins are for the test tunnel only"],
  ["PUBLIC_LINK_URL", "shareable links (sales TV, referral links, staff invitations) would point at the test tunnel instead of the site"],
];
/** Only for the 10-minute check after a deploy (docs/DEPLOY_NETLIFY.md section 7). */
export const PRODUCTION_TEMPORARY = ["PLATFORM_CHECK"];

const present = (env, name) => typeof env[name] === "string" && env[name].trim() !== "";

/**
 * Problems with the given values: `errors` stop the deploy, `warnings` are printed. `known` is how much can be read:
 * "values" (this process) checks formats too, "names" (Netlify: secret values are hidden) checks presence only.
 * Messages name variables, never values.
 */
export function checkEnv(env, mode, known = "values") {
  const errors = [];
  const warnings = [];
  const required = mode === "build" ? BUILD_REQUIRED : RUNTIME_REQUIRED;
  for (const name of required) if (!present(env, name)) errors.push(`${name} is not set.`);
  if (mode !== "build") {
    for (const [name, effect] of RUNTIME_RECOMMENDED) if (!present(env, name)) warnings.push(`${name} is not set: ${effect}.`);
    for (const name of PRODUCTION_FORBIDDEN) if (present(env, name)) errors.push(`${name} is set: it is for local development only. Remove it.`);
    for (const name of PRODUCTION_TEMPORARY) if (present(env, name)) warnings.push(`${name} is set: remove it after the post-deploy check.`);
    for (const [name, why] of PRODUCTION_TEST_ONLY) if (present(env, name)) warnings.push(`${name} is set: leave it empty in production (${why}).`);
    if (present(env, "AI_TEXT_PROVIDER")) {
      const provider = env.AI_TEXT_PROVIDER.trim();
      if (known === "values" && !["gemini", "claude"].includes(provider)) errors.push("AI_TEXT_PROVIDER must be gemini or claude.");
      const key = provider === "claude" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
      if (!present(env, key)) errors.push(`${key} is not set (AI_TEXT_PROVIDER needs it).`);
      // AI designs and photos use Gemini whatever writes the text.
      if (key !== "GEMINI_API_KEY" && !present(env, "GEMINI_API_KEY")) warnings.push("GEMINI_API_KEY is not set: AI designs and photos are off.");
    }
  }
  if (known === "values") {
    const url = env.NEXT_PUBLIC_SITE_URL?.trim();
    if (url && !/^https:\/\/[^/\s]+$/.test(url.replace(/\/$/, ""))) errors.push("NEXT_PUBLIC_SITE_URL must be the https address of the site (no path).");
    const supabase = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (supabase && !/^https:\/\//.test(supabase)) errors.push("NEXT_PUBLIC_SUPABASE_URL must start with https://.");
    if (mode !== "build") {
      if (present(env, "ENCRYPTION_KEY")) {
        let bytes = 0;
        try {
          bytes = Buffer.from(env.ENCRYPTION_KEY.trim(), "base64").length;
        } catch {}
        if (bytes !== 32) errors.push("ENCRYPTION_KEY must be 32 bytes in base64 (openssl rand -base64 32).");
      }
      for (const name of ["CRON_SECRET", "VIDEO_ROBOT_SECRET", "API_KEY_PEPPER"]) {
        if (present(env, name) && env[name].trim().length < 32) errors.push(`${name} is too short: use at least 32 random characters.`);
      }
      for (const name of ["AI_MONTHLY_BUDGET_USD", "AI_COMPANY_MONTHLY_USD", "MEDIA_PLATFORM_MAX_BYTES", "MEDIA_COMPANY_VIDEO_MAX_BYTES"]) {
        if (present(env, name) && !(Number(env[name]) > 0)) errors.push(`${name} must be a positive number.`);
      }
      if (present(env, "WIDGET_AI_SHARE")) {
        const share = Number(env.WIDGET_AI_SHARE);
        if (!(share >= 0 && share <= 1)) errors.push("WIDGET_AI_SHARE must be between 0 and 1.");
      }
      if (present(env, "MEDIA_PLATFORM_MAX_BYTES") && Number(env.MEDIA_PLATFORM_MAX_BYTES) > 1024 ** 3) {
        warnings.push("MEDIA_PLATFORM_MAX_BYTES is over 1 GB: more than the Supabase free plan stores.");
      }
      // Web Push keys (lib/push): base64url, a 65-byte uncompressed P-256 public key and its 32-byte private key.
      const b64urlBytes = (value) => (/^[A-Za-z0-9_-]+$/.test(value) ? Buffer.from(value, "base64url").length : -1);
      if (present(env, "VAPID_PUBLIC_KEY") && b64urlBytes(env.VAPID_PUBLIC_KEY.trim()) !== 65) errors.push("VAPID_PUBLIC_KEY must be a P-256 public key in base64url (65 bytes); see .env.example.");
      if (present(env, "VAPID_PRIVATE_KEY") && b64urlBytes(env.VAPID_PRIVATE_KEY.trim()) !== 32) errors.push("VAPID_PRIVATE_KEY must be a P-256 private key in base64url (32 bytes); see .env.example.");
      if (present(env, "VAPID_SUBJECT") && !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(env.VAPID_SUBJECT.trim())) errors.push("VAPID_SUBJECT must be a mailto: address or an https:// link.");
      if (present(env, "NEXT_PUBLIC_WHATSAPP_NUMBER") && !/^\+?[\d\s-]{8,20}$/.test(env.NEXT_PUBLIC_WHATSAPP_NUMBER.trim())) {
        errors.push("NEXT_PUBLIC_WHATSAPP_NUMBER must be an international phone number.");
      }
    }
  }
  return { errors, warnings };
}

/**
 * The names set in Netlify for production, as an env-like object whose values are "set" (Netlify does not return
 * secret values, and none is needed here). Only values for the production context (or every context) count.
 */
export async function netlifyEnv(token, siteId, fetchImpl = fetch) {
  const api = "https://api.netlify.com/api/v1";
  const headers = { authorization: `Bearer ${token}` };
  const site = await fetchImpl(`${api}/sites/${encodeURIComponent(siteId)}`, { headers });
  if (!site.ok) throw new Error(`Netlify answered ${site.status} for the site.`);
  const { account_id: account } = await site.json();
  const res = await fetchImpl(`${api}/accounts/${encodeURIComponent(account)}/env?site_id=${encodeURIComponent(siteId)}`, { headers });
  if (!res.ok) throw new Error(`Netlify answered ${res.status} for the environment variables.`);
  const vars = await res.json();
  const env = {};
  for (const v of Array.isArray(vars) ? vars : []) {
    const scoped = !Array.isArray(v.scopes) || v.scopes.includes("functions") || v.scopes.includes("runtime");
    const forProduction = (v.values ?? []).some((x) => ["all", "production"].includes(x.context));
    if (v.key && scoped && forProduction) env[v.key] = "set";
  }
  return env;
}

/** The Worker's name and whether wrangler.jsonc binds a real Hyperdrive config (not the TODO placeholder). Pure. */
export function wranglerInfo(jsonc) {
  const name = /"name":\s*"([^"]+)"/.exec(jsonc)?.[1] ?? null;
  const id = /"hyperdrive":\s*\[[\s\S]*?"id":\s*"([^"]*)"/.exec(jsonc)?.[1] ?? "";
  return { name, hyperdrive: /^[0-9a-f]{32}$/.test(id) };
}

/**
 * The secret names set on the Worker, as an env-like object whose values are "set" (Cloudflare never returns secret
 * values). On Cloudflare the database is the Hyperdrive binding (lib/platform/database.ts), so with one DATABASE_URL
 * counts as set.
 */
export async function cloudflareEnv(token, accountId, worker, hyperdrive, fetchImpl = fetch) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/secrets`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) throw new Error(`Cloudflare has no Worker named ${worker} yet: set its secrets first (wrangler secret put creates it, docs/DEPLOY.md).`);
  if (!res.ok) throw new Error(`Cloudflare answered ${res.status} for the Worker's secrets.`);
  const { result } = await res.json();
  const env = {};
  for (const s of Array.isArray(result) ? result : []) if (s?.name) env[s.name] = "set";
  if (hyperdrive) env.DATABASE_URL = "set";
  return env;
}

function report({ errors, warnings }, label) {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
  console.log(errors.length ? `${label}: ${errors.length} problem(s). Fix them before deploying.` : `${label}: ok.`);
  return errors.length ? 1 : 0;
}

async function main(argv) {
  const mode = argv.includes("--cloudflare") ? "cloudflare" : argv.includes("--netlify") ? "netlify" : argv.includes("--runtime") ? "runtime" : "build";
  if (mode === "netlify") {
    const { NETLIFY_AUTH_TOKEN: token, NETLIFY_SITE_ID: site } = process.env;
    if (!token || !site) {
      console.log("error: NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID are needed to read Netlify's variables.");
      return 1;
    }
    return report(checkEnv(await netlifyEnv(token, site), "runtime", "names"), "Netlify runtime variables");
  }
  if (mode === "cloudflare") {
    const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
    if (!token || !account) {
      console.log("error: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed to read the Worker's secrets.");
      return 1;
    }
    const { readFileSync } = await import("node:fs");
    const { name, hyperdrive } = wranglerInfo(readFileSync("wrangler.jsonc", "utf8"));
    if (!name) {
      console.log("error: wrangler.jsonc has no Worker name.");
      return 1;
    }
    const result = checkEnv(await cloudflareEnv(token, account, name, hyperdrive), "runtime", "names");
    // Without Hyperdrive the database is what is missing, not DATABASE_URL (Workers do not use it).
    if (!hyperdrive) result.errors = ["wrangler.jsonc has no Hyperdrive config id (TODO_HYPERDRIVE_CONFIG_ID): see docs/DEPLOY.md section 1.", ...result.errors.filter((e) => !e.startsWith("DATABASE_URL "))];
    return report(result, "Cloudflare Worker secrets");
  }
  return report(checkEnv(process.env, mode, "values"), mode === "build" ? "Build variables" : "Runtime variables");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      // The message of our own errors only: never a response body or a value.
      console.log(`error: ${error instanceof Error ? error.message : "check failed"}`);
      process.exit(1);
    },
  );
}
