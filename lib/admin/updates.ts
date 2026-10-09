import "server-only";
import { prisma } from "@/lib/db";
import { rateLimit, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";
import { currentBuild, updateState, type BuildInfo, type UpdateState } from "@/lib/version";
import { writeAudit } from "./audit";
import { GitHubClient, githubConfig, isActiveRun, type LatestRelease, type WorkflowRun } from "./github";
import { AdminError, type AdminContext } from "./types";

// Updates: the running build, the newest release on GitHub and the deploy workflow's runs. Installing or rolling
// back only ever starts the official GitHub Actions workflow (deploy.yml); the admin never uploads code.
// Both are console-only (a person with an authenticator code), confirmed, audited and limited to one run at a time.

export const RUN_LIMIT = 10;
/** One workflow start per minute, whoever asks. Covers the seconds before GitHub lists the new run as queued. */
export const DISPATCH_RULE: RateLimitRule = { limit: 1, windowSeconds: 60 };
const DISPATCH_KEY = "admin-updates:dispatch";

export type UpdateStatus = {
  current: BuildInfo;
  connected: boolean;
  repo: string | null;
  latest: LatestRelease | null;
  state: UpdateState | "not_connected";
  runs: WorkflowRun[];
  /** The run that is queued or in progress right now, if any. */
  inFlight: WorkflowRun | null;
  /** Why GitHub data is missing, in plain words (the page still renders). */
  error: string | null;
};

const client = (cfg: NonNullable<ReturnType<typeof githubConfig>>) => new GitHubClient(cfg);

function describe(e: unknown): string {
  return e instanceof AdminError ? e.message : "GitHub could not be reached.";
}

/** Everything the Updates page and the get_update_status tool show. Never throws for GitHub trouble. */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  const current = currentBuild();
  const cfg = githubConfig();
  if (!cfg) return { current, connected: false, repo: null, latest: null, state: "not_connected", runs: [], inFlight: null, error: null };
  const gh = client(cfg);
  const [latest, runs] = await Promise.all([gh.latestRelease().then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e })), gh.listDeployRuns(RUN_LIMIT).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e }))]);
  const errors = [latest.ok ? null : describe(latest.e), runs.ok ? null : describe(runs.e)].filter((s): s is string => Boolean(s));
  const runList = runs.ok ? runs.r : [];
  return {
    current,
    connected: true,
    repo: cfg.repo,
    latest: latest.ok ? latest.r : null,
    state: latest.ok ? updateState(current, { version: latest.r.version, sha: latest.r.sha }) : "unknown",
    runs: runList,
    inFlight: runList.find(isActiveRun) ?? null,
    error: errors.length ? [...new Set(errors)].join(" ") : null,
  };
}

/** The deploy workflow's newest runs, for the page's refresh. */
export async function listDeployRuns(): Promise<{ runs: WorkflowRun[]; inFlight: WorkflowRun | null }> {
  const cfg = githubConfig();
  if (!cfg) return { runs: [], inFlight: null };
  const runs = await client(cfg).listDeployRuns(RUN_LIMIT);
  return { runs, inFlight: runs.find(isActiveRun) ?? null };
}

function requireConsole(ctx: AdminContext, what: string) {
  if (ctx.viaApi) throw new AdminError("forbidden", `${what} can only be done by a person in the admin console.`);
}

function requireConnected() {
  const cfg = githubConfig();
  if (!cfg) throw new AdminError("unavailable", "Updates are not connected: set GITHUB_REPO and GITHUB_TOKEN in the Worker environment.");
  return cfg;
}

async function refuseWhileRunning(gh: GitHubClient) {
  const running = (await gh.listDeployRuns(RUN_LIMIT)).find(isActiveRun);
  if (running) throw new AdminError("conflict", `A deploy is already ${running.status === "in_progress" ? "running" : "queued"} (run #${running.id}). Wait for it to finish.`);
}

async function limitDispatch() {
  try {
    await rateLimit(DISPATCH_KEY, DISPATCH_RULE);
  } catch (e) {
    if (e instanceof RateLimitError) throw new AdminError("conflict", "A deploy was started less than a minute ago. Give GitHub a moment, then refresh.");
    throw e;
  }
}

const REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,120}$/;

/**
 * Starts the deploy workflow for a release tag or commit SHA. `confirm` must be true (the console's dialog sets it
 * after the admin typed the version). Refused while a run is queued or in progress and more than once a minute.
 */
export async function installUpdate(ctx: AdminContext, input: { ref: string; version?: string | null; confirm?: boolean }) {
  requireConsole(ctx, "Installing an update");
  if (input.confirm !== true) throw new AdminError("confirm_required", "Confirm the version to install.");
  const ref = input.ref.trim();
  if (!REF.test(ref) || ref.includes("..")) throw new AdminError("invalid", "That is not a valid release tag or commit.");
  const gh = client(requireConnected());
  await refuseWhileRunning(gh);
  await limitDispatch();
  await gh.dispatchDeploy({ ref, action: "deploy", environment: "production" });
  await writeAudit(prisma, ctx, "install_update", `release:${ref}`, { version: currentBuild().version, sha: currentBuild().sha }, { ref, version: input.version ?? null, action: "deploy" });
  return { ref, action: "deploy" as const };
}

/**
 * Starts the workflow with action=rollback: it runs `wrangler rollback`, which puts the previous Worker version
 * back. Database migrations are not undone (docs/UPDATES.md). Console-only, confirmed, audited.
 */
export async function rollbackDeploy(ctx: AdminContext, input: { reason: string; confirm?: boolean }) {
  requireConsole(ctx, "Rolling back");
  if (input.confirm !== true) throw new AdminError("confirm_required", "Tick the box to confirm the rollback.");
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 200) throw new AdminError("invalid", "Give a short reason (3 to 200 characters); it is saved in the audit log.");
  const gh = client(requireConnected());
  await refuseWhileRunning(gh);
  await limitDispatch();
  await gh.dispatchDeploy({ ref: "main", action: "rollback", environment: "production" });
  await writeAudit(prisma, ctx, "rollback_deploy", "worker:bupulse", { version: currentBuild().version, sha: currentBuild().sha }, { action: "rollback", reason });
  return { action: "rollback" as const };
}
