import "server-only";
import { prisma } from "@/lib/db";
import { rateLimit, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";
import { currentBuild, updateState, type BuildInfo, type UpdateState } from "@/lib/version";
import { writeAudit } from "./audit";
import { DEPLOY_HOSTS, deployHost, type DeployHost } from "./deploy-host";
import { GitHubClient, githubConfig, isActiveRun, type LatestRelease, type WorkflowRun } from "./github";
import { AdminError, type AdminContext } from "./types";

// Updates: the running build, the newest release on GitHub and the deploy workflow's runs. Installing or rolling
// back only ever starts the official GitHub Actions workflow (deploy.yml for Cloudflare, deploy-netlify.yml for
// Netlify, lib/admin/deploy-host.ts); the admin never uploads code.
// Both are console-only (a person with an authenticator code), confirmed, audited and limited to one run at a time.

export const RUN_LIMIT = 10;
/** One workflow start per minute, whoever asks. Covers the seconds before GitHub lists the new run as queued. */
export const DISPATCH_RULE: RateLimitRule = { limit: 1, windowSeconds: 60 };
const DISPATCH_KEY = "admin-updates:dispatch";

export type UpdateStatus = {
  current: BuildInfo;
  /** Where deploys go (the host BuPulse runs on, or DEPLOY_TARGET). */
  host: DeployHost;
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
  const host = deployHost();
  const cfg = githubConfig();
  if (!cfg) return { current, host, connected: false, repo: null, latest: null, state: "not_connected", runs: [], inFlight: null, error: null };
  const gh = client(cfg);
  const [latest, runs] = await Promise.all([gh.latestRelease().then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e })), gh.listDeployRuns(RUN_LIMIT).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e }))]);
  const errors = [latest.ok ? null : describe(latest.e), runs.ok ? null : describe(runs.e)].filter((s): s is string => Boolean(s));
  const runList = runs.ok ? runs.r : [];
  return {
    current,
    host,
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
  if (!cfg) throw new AdminError("unavailable", `Updates are not connected: set GITHUB_REPO and GITHUB_TOKEN in the ${DEPLOY_HOSTS[deployHost()].runtime} environment.`);
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

/** A release tag (v1.2.3). Anything else must be a full commit SHA. */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
export const COMMIT_SHA = /^[0-9a-f]{40}$/;
/** The only GitHub environment deploys run in (the workflow's `environment` input accepts nothing else). */
export const DEPLOY_ENVIRONMENT = "production";

/**
 * Only a release tag (vX.Y.Z) or a full commit SHA that is already on main can be installed: a branch name or a commit
 * that never went through review is refused here, and again by the workflow (docs/UPDATES.md).
 */
async function checkRef(gh: GitHubClient, ref: string) {
  if (RELEASE_TAG.test(ref)) return;
  if (!COMMIT_SHA.test(ref)) throw new AdminError("invalid", "Choose a release tag (like v1.2.0) or a full 40-character commit SHA.");
  if (!(await gh.isAncestorOfMain(ref))) throw new AdminError("invalid", "That commit is not on main. Only commits merged into main can be installed.");
}

/**
 * Starts the deploy workflow for a release tag or commit SHA. `confirm` must be true (the console's dialog sets it
 * after the admin typed the version). Refused while a run is queued or in progress and more than once a minute.
 */
export async function installUpdate(ctx: AdminContext, input: { ref: string; version?: string | null; confirm?: boolean }) {
  requireConsole(ctx, "Installing an update");
  if (input.confirm !== true) throw new AdminError("confirm_required", "Confirm the version to install.");
  const ref = input.ref.trim();
  if (!RELEASE_TAG.test(ref) && !COMMIT_SHA.test(ref)) throw new AdminError("invalid", "Choose a release tag (like v1.2.0) or a full 40-character commit SHA.");
  const gh = client(requireConnected());
  await checkRef(gh, ref);
  await refuseWhileRunning(gh);
  await limitDispatch();
  await gh.dispatchDeploy({ ref, action: "deploy", environment: DEPLOY_ENVIRONMENT });
  await writeAudit(prisma, ctx, "install_update", `release:${ref}`, { version: currentBuild().version, sha: currentBuild().sha }, { ref, version: input.version ?? null, action: "deploy" });
  return { ref, action: "deploy" as const };
}

/**
 * Starts the workflow with action=rollback: on Cloudflare it runs `wrangler rollback`, which puts the previous Worker
 * version back; on Netlify it restores the production deploy before the current one. Database migrations are not
 * undone (docs/UPDATES.md). Console-only, confirmed, audited.
 */
export async function rollbackDeploy(ctx: AdminContext, input: { reason: string; confirm?: boolean }) {
  requireConsole(ctx, "Rolling back");
  if (input.confirm !== true) throw new AdminError("confirm_required", "Tick the box to confirm the rollback.");
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 200) throw new AdminError("invalid", "Give a short reason (3 to 200 characters); it is saved in the audit log.");
  const gh = client(requireConnected());
  await refuseWhileRunning(gh);
  await limitDispatch();
  await gh.dispatchDeploy({ ref: "main", action: "rollback", environment: DEPLOY_ENVIRONMENT }); // the workflow ignores ref for a rollback
  await writeAudit(prisma, ctx, "rollback_deploy", DEPLOY_HOSTS[deployHost()].auditTarget, { version: currentBuild().version, sha: currentBuild().sha }, { action: "rollback", reason });
  return { action: "rollback" as const };
}
