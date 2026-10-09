// The running build. APP_VERSION and BUILD_SHA are inlined by next.config.ts at build time (APP_VERSION from
// package.json "version", BUILD_SHA from the deploy workflow's environment); a local `next dev` shows "local".
// No server imports: safe to import anywhere.

export type BuildInfo = { version: string; sha: string; short: string };

/** The build this process is running. */
export function currentBuild(): BuildInfo {
  return buildInfo(process.env.APP_VERSION, process.env.BUILD_SHA);
}

export function buildInfo(version: string | undefined, sha: string | undefined): BuildInfo {
  const v = normalizeVersion(version ?? "") || "0.0.0";
  const s = (sha ?? "").trim() || "local";
  return { version: v, sha: s, short: shortSha(s) };
}

/** First 7 characters of a commit SHA; anything else ("local", a tag) is returned as is. */
export function shortSha(sha: string): string {
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : sha;
}

/** "v1.2.0" or "release-1.2.0" -> "1.2.0"; "" when there is no version-like text at all. */
export function normalizeVersion(text: string): string {
  const m = text.trim().match(/\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?/);
  return m ? m[0] : "";
}

/** Numeric comparison of dotted versions: negative when a < b, 0 when equal, positive when a > b. Pre-release tags sort before the release. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(normalizeVersion(a));
  const pb = parse(normalizeVersion(b));
  const n = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < n; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

function parse(v: string): { nums: number[]; pre: string } {
  const [core, pre = ""] = v.split(/[-+]/, 2);
  return { nums: core ? core.split(".").map((x) => Number(x) || 0) : [], pre };
}

export type UpdateState = "up_to_date" | "update_available" | "ahead" | "unknown";

/**
 * How the running build compares with the newest release. A release without a version number (a bare commit) can
 * only be compared by SHA: same SHA means up to date, otherwise unknown.
 */
export function updateState(current: BuildInfo, latest: { version: string | null; sha: string | null } | null): UpdateState {
  if (!latest) return "unknown";
  if (latest.sha && current.sha !== "local" && latest.sha.toLowerCase() === current.sha.toLowerCase()) return "up_to_date";
  const lv = latest.version ? normalizeVersion(latest.version) : "";
  if (!lv) return "unknown";
  const d = compareVersions(lv, current.version);
  if (d > 0) return "update_available";
  if (d < 0) return "ahead";
  // Same version number but a different SHA: a tag that moved or a hotfix on main. Say "up to date" only when the
  // SHA agrees or is not known.
  return latest.sha && current.sha !== "local" ? "update_available" : "up_to_date";
}
