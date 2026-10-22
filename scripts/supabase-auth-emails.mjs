#!/usr/bin/env node
// Installs BuPulse's auth emails (supabase/templates) and URL settings on one Supabase project through the Management
// API (docs/EMAIL_SETUP.md, "Install the emails"):
//
//   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/supabase-auth-emails.mjs <project-ref> \
//     --site https://test.bupulse.com --allow "https://test.bupulse.com/**,http://localhost:3001/**" [--dry-run]
//
// Options: --site (Site URL: the address the email links use), --allow (Redirect URLs, comma-separated),
// --otp-length 6..10 and --otp-exp <seconds> (kept as they are unless given), --dry-run (show what would change,
// send nothing). Prints field names, lengths, subjects and URLs only: never the token or the email bodies.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "templates");
const API = "https://api.supabase.com/v1/projects";
/** The 24 hours the emails promise. */
export const EXPECTED_OTP_EXP = 86400;

/** subjects.json key → the two Management API fields it fills. */
export const FIELDS = {
  confirmation: { subject: "mailer_subjects_confirmation", content: "mailer_templates_confirmation_content", link: "type=email" },
  recovery: { subject: "mailer_subjects_recovery", content: "mailer_templates_recovery_content", link: "type=recovery" },
  email_change: { subject: "mailer_subjects_email_change", content: "mailer_templates_email_change_content", link: "type=email_change" },
  magic_link: { subject: "mailer_subjects_magic_link", content: "mailer_templates_magic_link_content", link: null },
};

export function parseArgs(argv) {
  const out = { ref: null, site: null, allow: null, otpLength: null, otpExp: null, dryRun: false };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--site") out.site = value(i++, a);
    else if (a === "--allow") out.allow = value(i++, a);
    else if (a === "--otp-length") out.otpLength = value(i++, a);
    else if (a === "--otp-exp") out.otpExp = value(i++, a);
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else if (!out.ref) out.ref = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  if (!out.ref || !/^[a-z0-9]{20}$/.test(out.ref)) throw new Error("Give the project ref (20 lowercase letters and digits) as the first argument");
  if (out.site !== null) out.site = checkSite(out.site);
  if (out.allow !== null) out.allow = checkAllow(out.allow);
  if (out.otpLength !== null) {
    const n = Number(out.otpLength);
    if (!Number.isInteger(n) || n < 6 || n > 10) throw new Error("--otp-length must be a whole number from 6 to 10");
    out.otpLength = n;
  }
  if (out.otpExp !== null) {
    const n = Number(out.otpExp);
    if (!Number.isInteger(n) || n < 60 || n > 86400) throw new Error("--otp-exp must be seconds from 60 to 86400");
    out.otpExp = n;
  }
  return out;
}

const isLocal = (host) => /^(localhost|127\.0\.0\.1)$/.test(host);

/** An https origin (http only for localhost), without a path or a trailing slash. */
export function checkSite(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--site must be a full address, like https://test.bupulse.com");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal(url.hostname))) throw new Error("--site must use https (http only for localhost)");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("--site must be an origin only, like https://test.bupulse.com");
  return url.origin;
}

/** Comma-separated redirect patterns, each an https (or localhost http) address, joined the way the API stores them. */
export function checkAllow(value) {
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!items.length) throw new Error("--allow needs at least one address");
  for (const item of items) {
    const m = /^(https?):\/\/([^/:*]+)(:\d+)?(\/.*)?$/.exec(item);
    if (!m) throw new Error(`--allow: ${item} is not an address like https://test.bupulse.com/**`);
    if (m[1] === "http" && !isLocal(m[2])) throw new Error(`--allow: ${item} must use https (http only for localhost)`);
  }
  return [...new Set(items)].join(",");
}

/** The templates and subjects from supabase/templates, checked: every email has the code, link emails link to /auth/confirm. */
export function loadTemplates(dir = TEMPLATES_DIR) {
  const subjects = JSON.parse(readFileSync(join(dir, "subjects.json"), "utf8"));
  const out = {};
  for (const [key, spec] of Object.entries(FIELDS)) {
    const entry = subjects[key];
    if (!entry?.file || !entry?.subject) throw new Error(`subjects.json has no file and subject for ${key}`);
    const html = readFileSync(join(dir, entry.file), "utf8");
    checkTemplate(key, html, spec);
    out[key] = { subject: entry.subject, html };
  }
  return out;
}

export function checkTemplate(key, html, spec = FIELDS[key]) {
  if (!html.includes("{{ .Token }}")) throw new Error(`${key}: the email has no {{ .Token }} code`);
  if (spec.link) {
    const link = `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;${spec.link}`;
    if (!html.includes(link)) throw new Error(`${key}: the button must link to ${link}`);
    if (html.includes("{{ .ConfirmationURL }}")) throw new Error(`${key}: use the /auth/confirm link, not {{ .ConfirmationURL }}`);
  } else if (/href="\{\{ \.(ConfirmationURL|SiteURL)/.test(html)) {
    throw new Error(`${key}: the admin code email must not contain a sign-in link`);
  }
}

/** The fields to send: templates and subjects always, URLs and OTP settings only when asked. */
export function buildPatch(templates, opts) {
  const patch = {};
  for (const [key, spec] of Object.entries(FIELDS)) {
    patch[spec.subject] = templates[key].subject;
    patch[spec.content] = templates[key].html;
  }
  if (opts.site) patch.site_url = opts.site;
  if (opts.allow) patch.uri_allow_list = opts.allow;
  if (opts.otpLength) patch.mailer_otp_length = opts.otpLength;
  if (opts.otpExp) patch.mailer_otp_exp = opts.otpExp;
  return patch;
}

/** One line per field, safe to print: lengths for email bodies, values for subjects, URLs and numbers. */
export function summarize(current, patch) {
  const lines = [];
  for (const [field, next] of Object.entries(patch)) {
    const before = current?.[field];
    const same = before === next;
    if (field.endsWith("_content")) {
      lines.push(`${field}: ${same ? "unchanged" : `${typeof before === "string" ? before.length : 0} → ${String(next).length} characters`}`);
    } else {
      lines.push(`${field}: ${same ? `unchanged (${JSON.stringify(next)})` : `${JSON.stringify(before ?? null)} → ${JSON.stringify(next)}`}`);
    }
  }
  for (const field of ["site_url", "uri_allow_list", "mailer_otp_length", "mailer_otp_exp"]) {
    if (!(field in patch)) lines.push(`${field}: kept (${JSON.stringify(current?.[field] ?? null)})`);
  }
  return lines;
}

/** Warnings about the settings the emails rely on. */
export function warnings(current, patch) {
  const site = patch.site_url ?? current?.site_url ?? "";
  const exp = patch.mailer_otp_exp ?? current?.mailer_otp_exp;
  const out = [];
  if (/localhost|127\.0\.0\.1/.test(site)) out.push("site_url is localhost: email links will not open on other devices. Pass --site.");
  if (exp && exp !== EXPECTED_OTP_EXP) out.push(`mailer_otp_exp is ${exp} s, but the emails say 24 hours (${EXPECTED_OTP_EXP} s). Pass --otp-exp ${EXPECTED_OTP_EXP}.`);
  return out;
}

async function api(ref, token, init = {}) {
  const res = await fetch(`${API}/${ref}/config/auth`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Supabase answered ${res.status}${body?.message ? `: ${body.message}` : ""}`);
  return body;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens)");
  const patch = buildPatch(loadTemplates(), opts);
  const current = await api(opts.ref, token);
  console.log(`Project ${opts.ref}${opts.dryRun ? " (dry run: nothing is sent)" : ""}`);
  for (const line of summarize(current, patch)) console.log(`  ${line}`);
  for (const w of warnings(current, patch)) console.log(`  Warning: ${w}`);
  if (opts.dryRun) return;
  const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => current?.[k] !== v));
  if (!Object.keys(changed).length) return console.log("Nothing to change.");
  await api(opts.ref, token, { method: "PATCH", body: JSON.stringify(changed) });
  console.log(`Set: ${Object.keys(changed).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
