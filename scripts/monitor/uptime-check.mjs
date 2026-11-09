// The outside uptime check of bupulse.com, run every 5 minutes by .github/workflows/uptime.yml (free: the repository is
// public). No packages: Node's own fetch. docs/SUPPORT_DASHBOARD.md, "Server monitoring".
//
// 1. GET /api/status (up = 200 with status "ok"), and time /, /pricing and /login. Down: wait 60 s and try once more.
// 2. Up: POST the result to /api/monitor/uptime (Bearer UPTIME_SECRET); the server records it, finds outages from the
//    gaps between good checks, and sends the "back up" alert itself.
// 3. Down: send the "down" alert from here (Telegram, and email through Resend), but only when this workflow's previous
//    completed run succeeded, so a long outage sends one alert, not one every 5 minutes. Then fail the run: the failed
//    run is what the next run reads. A channel whose secret is missing is skipped; that never fails the run.
//
// The repository is public, so this log is public: it prints the result and which channels were used, never a secret.

import { pathToFileURL } from "node:url";

export const PAGES = ["/", "/pricing", "/login"];
const TIMEOUT_MS = 15_000;
const RETRY_AFTER_MS = 60_000;

async function timed(url, fetchImpl) {
  const started = performance.now();
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "BuPulse uptime check (GitHub Actions)", "cache-control": "no-cache" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.text();
    return { status: res.status, ms: Math.round(performance.now() - started), body };
  } catch {
    return { status: null, ms: null, body: "" };
  }
}

/** One look at the site: the health check, then each page. */
export async function checkOnce(site, fetchImpl = fetch) {
  const status = await timed(`${site}/api/status`, fetchImpl);
  let json = null;
  try {
    json = JSON.parse(status.body);
  } catch {
    json = null;
  }
  const ok = status.status === 200 && json?.status === "ok";
  const pages = [];
  for (const path of PAGES) {
    const r = await timed(`${site}${path}`, fetchImpl);
    pages.push({ path, status: r.status, ms: r.ms });
  }
  return {
    ok,
    statusCode: status.status,
    statusMs: status.ms,
    databaseMs: typeof json?.databaseMs === "number" ? json.databaseMs : null,
    version: typeof json?.version === "string" ? json.version : null,
    pages,
  };
}

/** The site is down only when it fails twice, about a minute apart. */
export async function checkWithRetry(site, { fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const first = await checkOnce(site, fetchImpl);
  if (first.ok) return { ...first, retried: false };
  await wait(RETRY_AFTER_MS);
  return { ...(await checkOnce(site, fetchImpl)), retried: true };
}

/**
 * The conclusion of this workflow's last completed run before this one ("success" or "failure"), or null when there is
 * none or GitHub could not be asked. Cancelled and skipped runs (a queue of late runs) checked nothing and are passed over.
 */
export async function previousConclusion({ repo, runId, token, workflow = "uptime.yml" }, fetchImpl = fetch) {
  if (!repo || !token) return null;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?status=completed&per_page=10&exclude_pull_requests=true`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const run = (data?.workflow_runs ?? []).find((r) => String(r.id) !== String(runId) && r.conclusion !== "cancelled" && r.conclusion !== "skipped");
    return typeof run?.conclusion === "string" ? run.conclusion : null;
  } catch {
    return null;
  }
}

/**
 * Send the "down" alert? Only when the previous run succeeded (the site was up 5 minutes ago), or when that cannot be
 * told (no earlier run, GitHub did not answer): a second alert is better than none.
 */
export function shouldAlertDown(previous) {
  return previous === null || previous === "success";
}

function kigaliTime(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function downMessage(site, result, now = new Date()) {
  const host = site.replace(/^https?:\/\//, "");
  const answer = result.statusCode === null ? "no answer" : `error ${result.statusCode}`;
  return {
    subject: `${host} looks down`,
    text:
      `${host} looks down. The outside check failed twice, a minute apart, at ${kigaliTime(now)} (Kigali time): the health check got ${answer}.\n\n` +
      "Things to check: is the home PC on and connected to the internet, and are the BuPulse server and tunnel tasks running?\n\n" +
      "This is the only message for this outage. When the site is back, BuPulse sends a \"back up\" message with how long it was down.",
  };
}

/** Telegram and email (Resend), each only when its secrets are set. Returns what happened per channel. */
export async function sendDownAlerts(env, message, fetchImpl = fetch) {
  const out = { telegram: "skipped", email: "skipped" };
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `🔴 ${message.text}`, link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      out.telegram = res.ok ? "sent" : `failed (${res.status})`;
    } catch {
      out.telegram = "failed (no answer)";
    }
  }
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: env.ALERT_FROM || "BuPulse <register@bupulse.com>", to: [env.ALERT_TO || "admin@bupulse.com"], subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      out.email = res.ok ? "sent" : `failed (${res.status})`;
    } catch {
      out.email = "failed (no answer)";
    }
  }
  return out;
}

/** Records the check on the server. Never throws: returns a short line for the log. */
export async function report(site, secret, payload, fetchImpl = fetch) {
  if (!secret) return "not recorded: the UPTIME_SECRET secret is not set";
  try {
    const res = await fetchImpl(`${site}/api/monitor/uptime`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? "recorded" : `not recorded: the server answered ${res.status}`;
  } catch {
    return "not recorded: the server did not answer";
  }
}

export async function main(env = process.env, fetchImpl = fetch) {
  const site = (env.SITE_URL || "https://bupulse.com").replace(/\/$/, "");
  const result = await checkWithRetry(site, { fetchImpl });
  const previous = await previousConclusion({ repo: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID, token: env.GITHUB_TOKEN }, fetchImpl);
  const times = result.pages.map((p) => `${p.path} ${p.status ?? "no answer"} ${p.ms ?? "-"} ms`).join(", ");
  console.log(`${result.ok ? "UP" : "DOWN"}: /api/status ${result.statusCode ?? "no answer"} ${result.statusMs ?? "-"} ms (database ${result.databaseMs ?? "-"} ms); ${times}${result.retried ? "; checked twice" : ""}. Previous run: ${previous ?? "unknown"}.`);
  // Best effort even when down: if only the database is down, the server can still store the failed check.
  console.log(`Check ${await report(site, env.UPTIME_SECRET, { ...result, afterFailure: previous === "failure" }, fetchImpl)}.`);
  if (result.ok) return 0;
  if (shouldAlertDown(previous)) {
    const sent = await sendDownAlerts(env, downMessage(site, result), fetchImpl);
    console.log(`Down alert: Telegram ${sent.telegram}, email ${sent.email}.`);
  } else {
    console.log("Down alert already sent for this outage (the previous run found the site down too).");
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`The check itself failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    },
  );
}
