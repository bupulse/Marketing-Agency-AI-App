// A small GitHub REST client for the Updates screen: the newest release, the deploy workflow's runs and
// workflow_dispatch. Pure fetch, no SDK, so it runs on Cloudflare Workers. The token is never returned or logged.
// No server imports: tests pass a fake fetch.

import { AdminError } from "./types";

export const DEPLOY_WORKFLOW_FILE = "deploy.yml";
/** The branch the workflow file is read from when dispatching (the target to deploy is passed as an input). */
export const DEFAULT_BRANCH = "main";
const API = "https://api.github.com";
const TIMEOUT_MS = 10_000;

export type GitHubConfig = { repo: string; token: string };

/** GITHUB_REPO ("owner/name") and GITHUB_TOKEN, or null when either is missing or malformed. */
export function githubConfig(env: Record<string, string | undefined> = process.env): GitHubConfig | null {
  const repo = (env.GITHUB_REPO ?? "").trim();
  const token = (env.GITHUB_TOKEN ?? "").trim();
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { repo, token };
}

export type LatestRelease = {
  /** release: a GitHub release. tag: the newest tag (no releases). commit: the tip of main (no tags either). */
  kind: "release" | "tag" | "commit";
  /** Version text as shown to the admin ("1.2.0"), or the short SHA for a bare commit. */
  version: string | null;
  /** What to deploy: the tag name, or the full commit SHA. Passed to the workflow's `ref` input. */
  ref: string;
  sha: string | null;
  name: string;
  publishedAt: string | null;
  notes: string | null;
  url: string;
};

export type RunStatus = "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending" | string;
export type WorkflowRun = {
  id: number;
  name: string;
  /** The run's title: the commit message for a push, "Deploy" for a manual start. */
  title: string;
  event: string;
  status: RunStatus;
  conclusion: string | null;
  branch: string | null;
  sha: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  url: string;
  actor: string | null;
};

export const ACTIVE_RUN_STATUSES = new Set<string>(["queued", "in_progress", "waiting", "requested", "pending"]);
export const isActiveRun = (run: Pick<WorkflowRun, "status">) => ACTIVE_RUN_STATUSES.has(run.status);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GitHubClient {
  constructor(
    private readonly cfg: GitHubConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await this.fetchImpl(`${API}${path}`, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.cfg.token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "bupulse-admin",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      throw new AdminError("unavailable", `GitHub did not answer (${e instanceof Error && e.name === "AbortError" ? "timed out" : "network error"}).`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async json<T>(path: string): Promise<T | null> {
    const res = await this.request(path);
    if (res.status === 404) return null;
    if (!res.ok) throw failure(res.status, "read from GitHub");
    return (await res.json()) as T;
  }

  /** The newest GitHub release; the newest tag when there are no releases; the tip of main when there are no tags. */
  async latestRelease(): Promise<LatestRelease> {
    const rel = await this.json<GhRelease>(`/repos/${this.cfg.repo}/releases/latest`);
    if (rel && !rel.draft) {
      const tag = await this.json<GhTagRef>(`/repos/${this.cfg.repo}/git/ref/tags/${encodeURIComponent(rel.tag_name)}`).catch(() => null);
      return {
        kind: "release",
        version: rel.tag_name,
        ref: rel.tag_name,
        sha: tag?.object?.sha ?? null,
        name: rel.name || rel.tag_name,
        publishedAt: rel.published_at ?? rel.created_at ?? null,
        notes: rel.body ?? null,
        url: rel.html_url,
      };
    }
    const tags = (await this.json<GhTag[]>(`/repos/${this.cfg.repo}/tags?per_page=1`)) ?? [];
    if (tags[0]) {
      const t = tags[0];
      const commit = await this.json<GhCommit>(`/repos/${this.cfg.repo}/commits/${t.commit.sha}`).catch(() => null);
      return {
        kind: "tag",
        version: t.name,
        ref: t.name,
        sha: t.commit.sha,
        name: t.name,
        publishedAt: commit?.commit?.committer?.date ?? commit?.commit?.author?.date ?? null,
        notes: commit?.commit?.message ?? null,
        url: `https://github.com/${this.cfg.repo}/releases/tag/${encodeURIComponent(t.name)}`,
      };
    }
    const head = await this.json<GhCommit>(`/repos/${this.cfg.repo}/commits/${DEFAULT_BRANCH}`);
    if (!head) throw new AdminError("not_found", `GitHub has no releases, tags or a "${DEFAULT_BRANCH}" branch for ${this.cfg.repo}.`);
    return {
      kind: "commit",
      version: null,
      ref: head.sha,
      sha: head.sha,
      name: `${DEFAULT_BRANCH} @ ${head.sha.slice(0, 7)}`,
      publishedAt: head.commit?.committer?.date ?? head.commit?.author?.date ?? null,
      notes: head.commit?.message ?? null,
      url: head.html_url,
    };
  }

  /** The newest runs of the deploy workflow, newest first. */
  async listDeployRuns(limit = 10): Promise<WorkflowRun[]> {
    const data = await this.json<{ workflow_runs: GhRun[] }>(`/repos/${this.cfg.repo}/actions/workflows/${DEPLOY_WORKFLOW_FILE}/runs?per_page=${limit}`);
    return (data?.workflow_runs ?? []).map((r) => ({
      id: r.id,
      name: r.name ?? "Deploy",
      title: r.display_title ?? r.name ?? "Deploy",
      event: r.event,
      status: r.status ?? "unknown",
      conclusion: r.conclusion ?? null,
      branch: r.head_branch ?? null,
      sha: r.head_sha,
      createdAt: r.created_at,
      startedAt: r.run_started_at ?? null,
      updatedAt: r.updated_at,
      url: r.html_url,
      actor: r.triggering_actor?.login ?? r.actor?.login ?? null,
    }));
  }

  /** Starts the deploy workflow (workflow_dispatch). GitHub answers 204 and the run appears a few seconds later. */
  async dispatchDeploy(inputs: { ref: string; action: "deploy" | "rollback"; environment: string }): Promise<void> {
    const res = await this.request(`/repos/${this.cfg.repo}/actions/workflows/${DEPLOY_WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: { ref: DEFAULT_BRANCH, inputs },
    });
    if (res.status === 204) return;
    if (res.status === 404) throw new AdminError("not_found", `GitHub could not find .github/workflows/${DEPLOY_WORKFLOW_FILE} on ${DEFAULT_BRANCH} in ${this.cfg.repo}, or the token cannot see the repository.`);
    if (res.status === 422) throw new AdminError("invalid", "GitHub refused the request: the workflow has no workflow_dispatch trigger or the inputs do not match it.");
    throw failure(res.status, "start the workflow");
  }
}

function failure(status: number, what: string): AdminError {
  if (status === 401) return new AdminError("forbidden", "GitHub refused the token (401). Check GITHUB_TOKEN.");
  if (status === 403) return new AdminError("forbidden", `GitHub refused to ${what} (403): the token needs Actions: write and Contents: read, or the rate limit is spent.`);
  return new AdminError("unavailable", `GitHub answered ${status} while trying to ${what}.`);
}

type GhRelease = { tag_name: string; name: string | null; body: string | null; draft: boolean; prerelease: boolean; html_url: string; published_at: string | null; created_at: string | null };
type GhTagRef = { object?: { sha: string } };
type GhTag = { name: string; commit: { sha: string } };
type GhCommit = { sha: string; html_url: string; commit?: { message?: string; author?: { date?: string }; committer?: { date?: string } } };
type GhRun = {
  id: number;
  name: string | null;
  display_title?: string | null;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
  html_url: string;
  actor?: { login: string } | null;
  triggering_actor?: { login: string } | null;
};
