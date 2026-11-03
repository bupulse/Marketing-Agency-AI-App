#!/usr/bin/env node
// Turns Netlify's production variables into a Cloud Run env file (docs/DEPLOY_CLOUDRUN.md, "Environment variables"):
//
//   npx netlify-cli env:list --json --context production | node scripts/cloudrun-env.mjs ~/bupulse-cloudrun.env.yaml
//   gcloud run deploy bupulse ... --env-vars-file ~/bupulse-cloudrun.env.yaml
//
// Reads the JSON on stdin ({"NAME": "value"}, or Netlify's API list of {key, values: [{context, value}]}), drops what
// only Netlify uses or Cloud Run sets itself, adds PLATFORM=cloudrun, and writes `NAME: "value"` lines (mode 600) to
// the path given. Prints variable NAMES and counts only, never a value. The file holds every secret: it must stay out
// of the repository (the script refuses a path inside it), and is best deleted after the deploy.

import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnv } from "./check-env.mjs";

/** Names Netlify sets or reads itself, Cloud Run's reserved names, and values that only matter at build or on Netlify. */
const DROP_EXACT = new Set([
  // Netlify's own build and runtime values.
  "NETLIFY", "URL", "DEPLOY_URL", "DEPLOY_PRIME_URL", "DEPLOY_ID", "SITE_ID", "SITE_NAME", "CONTEXT", "BRANCH", "HEAD",
  "COMMIT_REF", "CACHED_COMMIT_REF", "REPOSITORY_URL", "PULL_REQUEST", "REVIEW_ID", "BUILD_ID", "NODE_VERSION",
  "NPM_VERSION", "YARN_VERSION", "PNPM_VERSION", "AWS_LAMBDA_JS_RUNTIME", "LAMBDA_TASK_ROOT",
  // Netlify-only settings: the 60 s limit's AI picture count (lib/autopilot/visuals.ts); the host is set below.
  "AUTOPILOT_NETLIFY_AI_PICTURES", "PLATFORM", "DEPLOY_TARGET",
  // Build-time only, or only for the migrations run from GitHub (never needed by the running app).
  "BUILD_SHA", "DIRECT_URL", "NEXT_TELEMETRY_DISABLED",
  // Cloud Run sets these itself and refuses them.
  "PORT", "K_SERVICE", "K_REVISION", "K_CONFIGURATION",
]);
const DROP_PREFIX = ["NETLIFY_", "INCOMING_HOOK_", "CLOUD_RUN_", "X_GOOGLE_"];

/** True for a value the CLI hid instead of returning (a secret it cannot read): only asterisks. */
const masked = (value) => /^\*+$/.test(value);

/** The production value of each variable from Netlify's JSON (either shape). */
export function parseNetlifyEnv(text) {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error("no JSON on stdin: pipe `netlify env:list --json --context production` into this script");
  const data = JSON.parse(text.slice(start));
  const env = {};
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item?.key !== "string") continue;
      const values = Array.isArray(item.values) ? item.values : [];
      const pick = values.find((v) => v?.context === "production") ?? values.find((v) => v?.context === "all");
      if (typeof pick?.value === "string") env[item.key] = pick.value;
    }
  } else if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) if (typeof value === "string") env[key] = value;
  }
  return env;
}

/** Splits Netlify's variables into what Cloud Run gets, what is dropped, and what the CLI did not reveal. */
export function toCloudRunEnv(netlify) {
  const env = {};
  const dropped = [];
  const hidden = [];
  for (const [name, value] of Object.entries(netlify)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || DROP_EXACT.has(name) || DROP_PREFIX.some((p) => name.startsWith(p))) dropped.push(name);
    else if (masked(value)) hidden.push(name);
    else if (value !== "") env[name] = value;
  }
  env.PLATFORM = "cloudrun";
  return { env, dropped: dropped.sort(), hidden: hidden.sort() };
}

/** The --env-vars-file YAML: one `NAME: "value"` per line (a JSON string is a valid YAML double-quoted string). */
export function toYaml(env) {
  return `${Object.keys(env)
    .sort()
    .map((name) => `${name}: ${JSON.stringify(env[name])}`)
    .join("\n")}\n`;
}

/** True when `file` is inside `folder`. */
export function inside(folder, file) {
  const rel = relative(folder, file);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv) {
  const target = argv[0];
  if (!target) {
    console.log("usage: netlify env:list --json --context production | node scripts/cloudrun-env.mjs <output.yaml>");
    return 1;
  }
  const out = resolve(target.replace(/^~(?=\/|$)/, homedir()));
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (inside(repo, out)) {
    console.log("error: the env file holds every secret; write it outside the repository (for example ~/bupulse-cloudrun.env.yaml).");
    return 1;
  }
  const { env, dropped, hidden } = toCloudRunEnv(parseNetlifyEnv(await readStdin()));
  writeFileSync(out, toYaml(env), { mode: 0o600 });
  console.log(`Wrote ${Object.keys(env).length} variables to ${out} (mode 600).`);
  if (dropped.length) console.log(`Dropped (Netlify-only, build-only or set by Cloud Run): ${dropped.join(", ")}`);
  if (hidden.length) console.log(`warning: Netlify did not reveal these values; add them to the file by hand: ${hidden.join(", ")}`);
  const { errors, warnings } = checkEnv({ ...env, ...Object.fromEntries(hidden.map((n) => [n, "set"])) }, "runtime", "names");
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
  return errors.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      // Our own messages only: never a value from stdin.
      console.log(`error: ${error instanceof SyntaxError ? "stdin is not valid JSON" : error instanceof Error ? error.message : "failed"}`);
      process.exit(1);
    },
  );
}
