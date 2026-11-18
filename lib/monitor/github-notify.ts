import type { LeadAlert } from "@/lib/lead-alerts/format";

// The backup route for the owner's Telegram alerts (18 November 2026). From the office PC, api.telegram.org often does
// not answer (the ISP's route drops packets), so a lead alert or a site alert sent by the server over Telegram could be
// lost even after its retries (lib/lead-alerts/telegram.ts). When that happens the server starts the GitHub workflow
// .github/workflows/notify-owner.yml (workflow_dispatch, input `text`), which sends the Telegram message from GitHub's
// servers with the repository's secrets. Token: GITHUB_NOTIFY_TOKEN (a fine-grained token, Actions read/write on the
// repository only; .env.example, or Admin -> Services -> Telegram). No token: skipped, said once per server process.
//
// PRIVACY: the repository is PUBLIC and a workflow's inputs show on its run page, so the text sent here must never
// carry personal data. It is built only from the kind of alert and counts (leadBackupText, the callers' `backupText`),
// never from names, phone numbers, emails, messages, company names or links, and publicSafe strips anything that looks
// like one on top. Pure fetch, no server imports: tests/monitor/github-notify.test.ts.

export const GITHUB_NOTIFY_TOKEN_ENV = "GITHUB_NOTIFY_TOKEN";
export const NOTIFY_REPO = "bupulse/Marketing-Agency-AI-App";
export const NOTIFY_WORKFLOW = "notify-owner.yml";
const TIMEOUT_MS = 10_000;
const MAX_TEXT = 200;
/** Pause before the one retry. Tests set it to 0. */
export const githubNotifyRetry = { delayMs: 2_000 };

export type GithubNotifyOutcome = "sent" | "skipped" | "failed";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let saidNoToken = false;
/** Tests: say "no token" again. */
export function resetGithubNotifyWarning() {
  saidNoToken = false;
}

/**
 * The text without anything that could be personal: links, email addresses and phone-like numbers (7 or more digits,
 * with spaces, dots, dashes or brackets between them) are removed, the rest is one line of at most 200 characters.
 */
export function publicSafe(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/[^\s@]+@[^\s@]+/g, "")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

/** What the backup says about a lead alert: only its kind (and a reminder's count), never who or what. */
export function leadBackupText(alert: Pick<LeadAlert, "kind" | "reminder" | "chat">): string {
  switch (alert.kind) {
    case "quote":
      return alert.reminder
        ? `Reminder ${alert.reminder.n} of ${alert.reminder.of}: a quote request still waits for a call. Open Admin -> Quote requests.`
        : "New quote request waiting. Open Admin -> Quote requests.";
    case "contact":
      return "New message from the website's contact form. Check your email or Admin.";
    case "support_chat":
      return "New help chat on bupulse.com. Open the support app.";
    case "support_waiting":
      return alert.chat?.away ? "A website chat waits for a person (it became a ticket). Open the support app." : "A website chat waits for a person. Open the support app.";
  }
}

/**
 * Starts notify-owner.yml with `text` (made public-safe here again). "skipped" without a token, "sent" on GitHub's
 * 204, else "failed". 10 seconds per try; a try that timed out, could not connect or got a 5xx/429 is made once more.
 * Never throws.
 */
export async function notifyOwnerViaGithub(
  text: string,
  env: Record<string, string | undefined> = { GITHUB_NOTIFY_TOKEN: process.env.GITHUB_NOTIFY_TOKEN },
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): Promise<GithubNotifyOutcome> {
  try {
    const token = (env[GITHUB_NOTIFY_TOKEN_ENV] ?? "").trim();
    if (!token) {
      if (!saidNoToken) {
        saidNoToken = true;
        console.warn(`[alerts] Telegram failed and ${GITHUB_NOTIFY_TOKEN_ENV} is not set: no backup through GitHub (said once per server start).`);
      }
      return "skipped";
    }
    const safe = publicSafe(text);
    if (!safe) return "skipped";
    const once = async (): Promise<"sent" | "retry" | "failed"> => {
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${NOTIFY_REPO}/actions/workflows/${NOTIFY_WORKFLOW}/dispatches`, {
          method: "POST",
          headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "user-agent": "bupulse-alerts", "content-type": "application/json" },
          body: JSON.stringify({ ref: "main", inputs: { text: safe } }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
        if (res.status === 204) return "sent";
        return res.status >= 500 || res.status === 429 ? "retry" : "failed";
      } catch {
        return "retry";
      }
    };
    let r = await once();
    if (r === "retry") {
      if (githubNotifyRetry.delayMs > 0) await new Promise((done) => setTimeout(done, githubNotifyRetry.delayMs));
      r = await once();
    }
    if (r !== "sent") console.warn("[alerts] The GitHub backup for a failed Telegram alert did not start either.");
    return r === "sent" ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
