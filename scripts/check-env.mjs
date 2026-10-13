#!/usr/bin/env node
// Checks the production environment variables before a deploy (docs/DEPLOY_NETLIFY.md, docs/RELEASE_2.0.md). Prints
// variable NAMES and problems only, never a value. Exit code 1 when something required is missing or wrong.
//
//   node scripts/check-env.mjs --build     the build-time values in this process (the deploy workflow's env:
//                                          NEXT_PUBLIC_*, PLATFORM, and DIRECT_URL for the migrations)
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
  ["MEDIA_COMPANY_VIDEO_MAX_BYTES", "each company's Gallery videos stop at 300 MB"],
  ["ELEVENLABS_API_KEY", "voiceovers and Generate a track are off"],
  ["VIDEO_ROBOT_SECRET", "the video robot is off: owners make videos in their browser"],
  ["NEXT_PUBLIC_WHATSAPP_NUMBER", "no Chat on WhatsApp button"],
  ["TURNSTILE_SITE_KEY", "sign-up and chat rely on rate limits only"],
  ["TURNSTILE_SECRET_KEY", "sign-up and chat rely on rate limits only"],
  ["GOOGLE_CALENDAR_CLIENT_ID", "demo bookings use a meeting link and .ics only"],
  ["GITHUB_REPO", "Admin, Settings, Updates shows Not connected"],
  ["GITHUB_TOKEN", "Admin, Settings, Updates shows Not connected"],
];

/** Development-only switches that must never be on in production. */
export const PRODUCTION_FORBIDDEN = ["ANALYTICS_DEV_COUNTRY", "REGION_OVERRIDE"];
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

function report({ errors, warnings }, label) {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
  console.log(errors.length ? `${label}: ${errors.length} problem(s). Fix them before deploying.` : `${label}: ok.`);
  return errors.length ? 1 : 0;
}

async function main(argv) {
  const mode = argv.includes("--netlify") ? "netlify" : argv.includes("--runtime") ? "runtime" : "build";
  if (mode === "netlify") {
    const { NETLIFY_AUTH_TOKEN: token, NETLIFY_SITE_ID: site } = process.env;
    if (!token || !site) {
      console.log("error: NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID are needed to read Netlify's variables.");
      return 1;
    }
    return report(checkEnv(await netlifyEnv(token, site), "runtime", "names"), "Netlify runtime variables");
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
