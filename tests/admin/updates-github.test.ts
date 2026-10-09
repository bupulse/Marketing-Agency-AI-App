import { describe, expect, it, vi } from "vitest";
import { ACTIVE_RUN_STATUSES, GitHubClient, githubConfig, isActiveRun } from "@/lib/admin/github";
import { AdminError } from "@/lib/admin/types";

const CFG = { repo: "bupulse/bupulse", token: "github_pat_FAKE_token_0001" };
const SHA = "a".repeat(40);

type Route = (init?: RequestInit) => { status: number; body?: unknown };

/** A fake fetch keyed by path (after https://api.github.com). Records every call. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.replace("https://api.github.com", "");
    const route = routes[path];
    const r = route ? route(init) : { status: 404, body: { message: "Not Found" } };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  return { fetchImpl, calls };
}

const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);

describe("GITHUB_REPO and GITHUB_TOKEN", () => {
  it("needs both, and the repo as owner/name", () => {
    expect(githubConfig({ GITHUB_REPO: "bupulse/bupulse", GITHUB_TOKEN: "t" })).toEqual({ repo: "bupulse/bupulse", token: "t" });
    expect(githubConfig({ GITHUB_REPO: " bupulse/bupulse ", GITHUB_TOKEN: " t " })).toEqual({ repo: "bupulse/bupulse", token: "t" });
    expect(githubConfig({ GITHUB_REPO: "bupulse/bupulse" })).toBeNull();
    expect(githubConfig({ GITHUB_TOKEN: "t" })).toBeNull();
    expect(githubConfig({ GITHUB_REPO: "https://github.com/bupulse/bupulse", GITHUB_TOKEN: "t" })).toBeNull();
    expect(githubConfig({ GITHUB_REPO: "bupulse", GITHUB_TOKEN: "t" })).toBeNull();
    expect(githubConfig({})).toBeNull();
  });
});

describe("latest release", () => {
  it("uses the latest GitHub release, with its tag's commit", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "/repos/bupulse/bupulse/releases/latest": () => ({ status: 200, body: { tag_name: "v1.1.0", name: "Pilot fixes", body: "## Notes\n- one", draft: false, prerelease: false, html_url: "https://github.com/bupulse/bupulse/releases/tag/v1.1.0", published_at: "2026-10-09T10:00:00Z", created_at: "2026-10-09T09:00:00Z" } }),
      "/repos/bupulse/bupulse/git/ref/tags/v1.1.0": () => ({ status: 200, body: { object: { sha: SHA, type: "commit" } } }),
    });
    const latest = await new GitHubClient(CFG, fetchImpl).latestRelease();
    expect(latest).toEqual({ kind: "release", version: "v1.1.0", ref: "v1.1.0", sha: SHA, name: "Pilot fixes", publishedAt: "2026-10-09T10:00:00Z", notes: "## Notes\n- one", url: "https://github.com/bupulse/bupulse/releases/tag/v1.1.0" });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${CFG.token}`);
    expect(headers.accept).toBe("application/vnd.github+json");
    expect(headers["x-github-api-version"]).toBe("2022-11-28");
  });

  it("falls back to the newest tag when there are no releases", async () => {
    const { fetchImpl } = fakeFetch({
      "/repos/bupulse/bupulse/tags?per_page=1": () => ({ status: 200, body: [{ name: "v1.0.1", commit: { sha: SHA } }] }),
      [`/repos/bupulse/bupulse/commits/${SHA}`]: () => ({ status: 200, body: { sha: SHA, html_url: "u", commit: { message: "Version 1.0.1", committer: { date: "2026-10-08T00:00:00Z" } } } }),
    });
    const latest = await new GitHubClient(CFG, fetchImpl).latestRelease();
    expect(latest).toMatchObject({ kind: "tag", version: "v1.0.1", ref: "v1.0.1", sha: SHA, publishedAt: "2026-10-08T00:00:00Z", notes: "Version 1.0.1" });
  });

  it("falls back to the tip of main when there are no tags either", async () => {
    const { fetchImpl } = fakeFetch({
      "/repos/bupulse/bupulse/tags?per_page=1": () => ({ status: 200, body: [] }),
      "/repos/bupulse/bupulse/commits/main": () => ({ status: 200, body: { sha: SHA, html_url: "https://github.com/bupulse/bupulse/commit/" + SHA, commit: { message: "Demo capture", author: { date: "2026-10-07T00:00:00Z" } } } }),
    });
    const latest = await new GitHubClient(CFG, fetchImpl).latestRelease();
    expect(latest).toMatchObject({ kind: "commit", version: null, ref: SHA, sha: SHA, name: `main @ ${SHA.slice(0, 7)}`, publishedAt: "2026-10-07T00:00:00Z" });
  });

  it("explains a bad token and a 403", async () => {
    const { fetchImpl } = fakeFetch({ "/repos/bupulse/bupulse/releases/latest": () => ({ status: 401, body: { message: "Bad credentials" } }) });
    await expect(new GitHubClient(CFG, fetchImpl).latestRelease()).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("GITHUB_TOKEN") });
    const f2 = fakeFetch({ "/repos/bupulse/bupulse/releases/latest": () => ({ status: 403, body: {} }) });
    await expect(new GitHubClient(CFG, f2.fetchImpl).latestRelease()).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("Actions: write") });
    const f3 = fakeFetch({ "/repos/bupulse/bupulse/releases/latest": () => ({ status: 500, body: {} }) });
    expect(await code(new GitHubClient(CFG, f3.fetchImpl).latestRelease())).toBe("unavailable");
  });

  it("turns a network failure into an unavailable error, never exposing the token", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED ${CFG.token}`);
    });
    const err = await new GitHubClient(CFG, fetchImpl).latestRelease().catch((e: AdminError) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect((err as AdminError).code).toBe("unavailable");
    expect((err as AdminError).message).not.toContain(CFG.token);
  });
});

describe("deploy runs", () => {
  it("maps the workflow's runs, newest first, and knows which are active", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "/repos/bupulse/bupulse/actions/workflows/deploy.yml/runs?per_page=10": () => ({
        status: 200,
        body: {
          workflow_runs: [
            { id: 2, name: "Deploy", display_title: "Deploy", event: "workflow_dispatch", status: "in_progress", conclusion: null, head_branch: "main", head_sha: SHA, created_at: "2026-10-09T10:00:00Z", run_started_at: "2026-10-09T10:00:05Z", updated_at: "2026-10-09T10:01:00Z", html_url: "https://github.com/r/2", triggering_actor: { login: "owner" } },
            { id: 1, name: "Deploy", display_title: "Version 1.0.0", event: "push", status: "completed", conclusion: "success", head_branch: "main", head_sha: SHA, created_at: "2026-10-08T10:00:00Z", updated_at: "2026-10-08T10:09:00Z", html_url: "https://github.com/r/1", actor: { login: "owner" } },
          ],
        },
      }),
    });
    const runs = await new GitHubClient(CFG, fetchImpl).listDeployRuns();
    expect(calls[0].url).toContain("/actions/workflows/deploy.yml/runs?per_page=10");
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ id: 2, status: "in_progress", conclusion: null, startedAt: "2026-10-09T10:00:05Z", actor: "owner", url: "https://github.com/r/2" });
    expect(runs[1]).toMatchObject({ id: 1, title: "Version 1.0.0", event: "push", status: "completed", conclusion: "success", startedAt: null });
    expect(runs.filter(isActiveRun).map((r) => r.id)).toEqual([2]);
    expect([...ACTIVE_RUN_STATUSES]).toEqual(expect.arrayContaining(["queued", "in_progress", "waiting"]));
  });

  it("returns no runs when the workflow has never run", async () => {
    const { fetchImpl } = fakeFetch({});
    expect(await new GitHubClient(CFG, fetchImpl).listDeployRuns()).toEqual([]);
  });
});

describe("workflow_dispatch", () => {
  it("posts the inputs with the workflow read from main", async () => {
    const { fetchImpl, calls } = fakeFetch({ "/repos/bupulse/bupulse/actions/workflows/deploy.yml/dispatches": () => ({ status: 204 }) });
    await new GitHubClient(CFG, fetchImpl).dispatchDeploy({ ref: "v1.1.0", action: "deploy", environment: "production" });
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ref: "main", inputs: { ref: "v1.1.0", action: "deploy", environment: "production" } });
  });

  it("explains a missing workflow or a mismatch of inputs", async () => {
    const f404 = fakeFetch({});
    await expect(new GitHubClient(CFG, f404.fetchImpl).dispatchDeploy({ ref: "v1", action: "deploy", environment: "production" })).rejects.toMatchObject({ code: "not_found", message: expect.stringContaining("deploy.yml") });
    const f422 = fakeFetch({ "/repos/bupulse/bupulse/actions/workflows/deploy.yml/dispatches": () => ({ status: 422, body: { message: "Unexpected inputs provided" } }) });
    expect(await code(new GitHubClient(CFG, f422.fetchImpl).dispatchDeploy({ ref: "v1", action: "rollback", environment: "production" }))).toBe("invalid");
  });
});
