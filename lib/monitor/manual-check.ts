// The Server page's "Run a check now" button (app/support/(app)/server/actions.ts): the outside check started by hand
// on GitHub, and the plain words for when the next scheduled check is due. Pure fetch, no server imports:
// tests/monitor/manual-check.test.ts.

export const UPTIME_WORKFLOW = "uptime.yml";
/** Checks are meant to arrive every 5 minutes (GitHub's schedule and the server PC's own check). */
export const CHECK_EVERY_MS = 5 * 60_000;

export type ManualCheckPage = { path: string; status: number | null; ms: number | null };
export type ManualCheckResult = {
  checkedAt: string;
  site: string;
  ok: boolean;
  statusCode: number | null;
  statusMs: number | null;
  databaseMs: number | null;
  version: string | null;
  pages: ManualCheckPage[];
  /** GitHub's outside check: started too, not set up (no GITHUB_REPO / GITHUB_TOKEN), or GitHub refused. */
  outside: "started" | "not-set-up" | "failed";
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Starts .github/workflows/uptime.yml (workflow_dispatch) when GITHUB_REPO and GITHUB_TOKEN are set. Never throws. */
export async function dispatchOutsideCheck(env: Record<string, string | undefined>, fetchImpl: FetchLike = (i, init) => fetch(i, init)): Promise<ManualCheckResult["outside"]> {
  const repo = (env.GITHUB_REPO ?? "").trim();
  const token = (env.GITHUB_TOKEN ?? "").trim();
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return "not-set-up";
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${UPTIME_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "user-agent": "bupulse-support", "content-type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return res.status === 204 ? "started" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * When the next check is due, from the last one: seconds until it (0 when due), and how many minutes late it is once
 * more than a minute past due (GitHub runs late; the PC's own check fills in while it is on).
 */
export function nextCheck(lastIso: string | null, nowMs: number): { agoMinutes: number | null; inSeconds: number; lateMinutes: number } {
  if (!lastIso) return { agoMinutes: null, inSeconds: 0, lateMinutes: 0 };
  const last = new Date(lastIso).getTime();
  const due = last + CHECK_EVERY_MS;
  const past = nowMs - due;
  return {
    agoMinutes: Math.max(0, Math.floor((nowMs - last) / 60_000)),
    inSeconds: Math.max(0, Math.ceil((due - nowMs) / 1000)),
    lateMinutes: past > 60_000 ? Math.floor(past / 60_000) : 0,
  };
}

/** "2:05" for a countdown. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
