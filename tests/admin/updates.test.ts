import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  fetch: vi.fn(),
  requireAdmin: vi.fn(async () => ({ id: "u", email: "admin@bupulse.com" })),
  rateLimit: vi.fn(async () => {}),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": "198.51.100.1" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect:${u}`); }, notFound: () => { throw new Error("404"); } }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin: h.requireAdmin, isAdminSession: async () => h.requireAdmin().then(() => true, () => false) }));
vi.mock("@/lib/admin/service", () => ({ APPROVAL_TTL_MS: 1 }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    constructor(public retryAfterSeconds: number) {
      super("Too many requests");
    }
  }
  return { rateLimit: h.rateLimit, RateLimitError };
});

import { DISPATCH_RULE, getUpdateStatus, installUpdate, listDeployRuns, rollbackDeploy } from "@/lib/admin/updates";
import { installUpdateAction, rollbackAction } from "@/app/admin/(console)/settings/updates/actions";
import { GET as runsRoute } from "@/app/admin/(console)/settings/updates/runs/route";
import { callTool, findTool } from "@/lib/admin/tools";
import { AdminError, apiContext, consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const API = apiContext("key1", "203.0.113.5");
const SHA = "b".repeat(40);
const TOKEN = "github_pat_FAKE_service_token_0002";
const code = async (p: Promise<unknown>) => p.then(() => null, (e: AdminError) => e.code);
const audit = () => h.db.auditLog.rows;

type Route = { status: number; body?: unknown };
const release = { tag_name: "v1.1.0", name: "v1.1.0", body: "- Faster", draft: false, prerelease: false, html_url: "https://github.com/bupulse/bupulse/releases/tag/v1.1.0", published_at: "2026-10-09T10:00:00Z", created_at: null };
const run = (id: number, status: string, conclusion: string | null = null) => ({ id, name: "Deploy", display_title: "Deploy", event: "workflow_dispatch", status, conclusion, head_branch: "main", head_sha: SHA, created_at: "2026-10-09T10:00:00Z", updated_at: "2026-10-09T10:05:00Z", html_url: `https://github.com/r/${id}` });

let routes: Record<string, Route>;
const dispatches = () => h.fetch.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith("/dispatches"));

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  h.requireAdmin.mockResolvedValue({ id: "u", email: "admin@bupulse.com" });
  h.rateLimit.mockResolvedValue(undefined);
  process.env.GITHUB_REPO = "bupulse/bupulse";
  process.env.GITHUB_TOKEN = TOKEN;
  process.env.APP_VERSION = "1.0.0";
  process.env.BUILD_SHA = "c".repeat(40);
  routes = {
    "/repos/bupulse/bupulse/releases/latest": { status: 200, body: release },
    "/repos/bupulse/bupulse/git/ref/tags/v1.1.0": { status: 200, body: { object: { sha: SHA } } },
    "/repos/bupulse/bupulse/actions/workflows/deploy.yml/runs?per_page=10": { status: 200, body: { workflow_runs: [run(1, "completed", "success")] } },
    "/repos/bupulse/bupulse/actions/workflows/deploy.yml/dispatches": { status: 204 },
  };
  h.fetch.mockImplementation(async (url: string) => {
    const r = routes[url.replace("https://api.github.com", "")] ?? { status: 404, body: { message: "Not Found" } };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal("fetch", h.fetch);
});

describe("update status", () => {
  it("shows the running build, the newest release and the runs", async () => {
    const s = await getUpdateStatus();
    expect(s.connected).toBe(true);
    expect(s.current).toMatchObject({ version: "1.0.0", short: "ccccccc" });
    expect(s.latest).toMatchObject({ kind: "release", version: "v1.1.0", ref: "v1.1.0", sha: SHA });
    expect(s.state).toBe("update_available");
    expect(s.runs.map((r) => r.id)).toEqual([1]);
    expect(s.inFlight).toBeNull();
    expect(s.error).toBeNull();
    expect(JSON.stringify(s)).not.toContain(TOKEN);
  });

  it("says not connected when the env is missing, without calling GitHub", async () => {
    delete process.env.GITHUB_TOKEN;
    const s = await getUpdateStatus();
    expect(s).toMatchObject({ connected: false, state: "not_connected", latest: null, runs: [], repo: null });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(await listDeployRuns()).toEqual({ runs: [], inFlight: null });
  });

  it("still renders when GitHub fails, with the reason", async () => {
    routes["/repos/bupulse/bupulse/releases/latest"] = { status: 401, body: {} };
    routes["/repos/bupulse/bupulse/actions/workflows/deploy.yml/runs?per_page=10"] = { status: 401, body: {} };
    const s = await getUpdateStatus();
    expect(s.connected).toBe(true);
    expect(s.latest).toBeNull();
    expect(s.state).toBe("unknown");
    expect(s.error).toMatch(/GITHUB_TOKEN/);
  });

  it("is a read-only Jarvis tool; there is no install tool", async () => {
    const t = findTool("get_update_status")!;
    expect(t.kind).toBe("read");
    expect(t.description).toMatch(/admin console/);
    const out = (await callTool("get_update_status", {}, API)) as { state: string };
    expect(out.state).toBe("update_available");
    expect(findTool("install_update")).toBeNull();
    expect(findTool("rollback_deploy")).toBeNull();
  });
});

describe("install update", () => {
  it("starts the deploy workflow with the release as the ref, and writes the audit row", async () => {
    const out = await installUpdate(CONSOLE, { ref: "v1.1.0", version: "v1.1.0", confirm: true });
    expect(out).toEqual({ ref: "v1.1.0", action: "deploy" });
    expect(dispatches()).toHaveLength(1);
    expect(JSON.parse(String(dispatches()[0][1].body))).toEqual({ ref: "main", inputs: { ref: "v1.1.0", action: "deploy", environment: "production" } });
    expect(h.rateLimit).toHaveBeenCalledWith("admin-updates:dispatch", DISPATCH_RULE);
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ actor: "admin", action: "install_update", target: "release:v1.1.0", ip: "198.51.100.1", after: { ref: "v1.1.0", version: "v1.1.0", action: "deploy" }, before: { version: "1.0.0" } });
  });

  it("needs confirm and a sane ref", async () => {
    expect(await code(installUpdate(CONSOLE, { ref: "v1.1.0" }))).toBe("confirm_required");
    expect(await code(installUpdate(CONSOLE, { ref: "../evil", confirm: true }))).toBe("invalid");
    expect(await code(installUpdate(CONSOLE, { ref: "-x", confirm: true }))).toBe("invalid");
    expect(dispatches()).toHaveLength(0);
    expect(audit()).toHaveLength(0);
  });

  it("refuses from the API: installs are for a person in the console", async () => {
    expect(await code(installUpdate(API, { ref: "v1.1.0", confirm: true }))).toBe("forbidden");
    expect(await code(rollbackDeploy(API, { reason: "broken", confirm: true }))).toBe("forbidden");
    expect(dispatches()).toHaveLength(0);
  });

  it("refuses while a run is queued or in progress", async () => {
    routes["/repos/bupulse/bupulse/actions/workflows/deploy.yml/runs?per_page=10"] = { status: 200, body: { workflow_runs: [run(2, "queued"), run(1, "completed", "success")] } };
    await expect(installUpdate(CONSOLE, { ref: "v1.1.0", confirm: true })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("#2") });
    routes["/repos/bupulse/bupulse/actions/workflows/deploy.yml/runs?per_page=10"] = { status: 200, body: { workflow_runs: [run(3, "in_progress")] } };
    expect(await code(rollbackDeploy(CONSOLE, { reason: "broken", confirm: true }))).toBe("conflict");
    expect(dispatches()).toHaveLength(0);
    expect(audit()).toHaveLength(0);
  });

  it("allows one start per minute", async () => {
    const { RateLimitError } = await import("@/lib/rate-limit");
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(45));
    await expect(installUpdate(CONSOLE, { ref: "v1.1.0", confirm: true })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("minute") });
    expect(dispatches()).toHaveLength(0);
  });

  it("explains when GitHub is not connected", async () => {
    delete process.env.GITHUB_REPO;
    await expect(installUpdate(CONSOLE, { ref: "v1.1.0", confirm: true })).rejects.toMatchObject({ code: "unavailable", message: expect.stringContaining("GITHUB_REPO") });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("roll back", () => {
  it("starts the workflow with action=rollback and a reason in the audit log", async () => {
    await rollbackDeploy(CONSOLE, { reason: "Images broken after 1.1.0", confirm: true });
    expect(JSON.parse(String(dispatches()[0][1].body))).toEqual({ ref: "main", inputs: { ref: "main", action: "rollback", environment: "production" } });
    expect(audit()[0]).toMatchObject({ action: "rollback_deploy", target: "worker:bupulse", after: { action: "rollback", reason: "Images broken after 1.1.0" } });
  });

  it("needs the confirmation and a reason", async () => {
    expect(await code(rollbackDeploy(CONSOLE, { reason: "broken" }))).toBe("confirm_required");
    expect(await code(rollbackDeploy(CONSOLE, { reason: "x", confirm: true }))).toBe("invalid");
    expect(dispatches()).toHaveLength(0);
  });
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const redirected = (p: Promise<unknown>) => p.then(() => "no redirect", (e: Error) => e.message);

describe("console actions", () => {
  it("require the AAL2 admin check before anything else", async () => {
    h.requireAdmin.mockRejectedValue(new Error("404"));
    await expect(installUpdateAction(form({ ref: "v1.1.0", version: "v1.1.0", typed: "v1.1.0" }))).rejects.toThrow("404");
    await expect(rollbackAction(form({ reason: "broken", confirm: "on" }))).rejects.toThrow("404");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(0);
  });

  it("install: the typed version must match, then the deploy starts", async () => {
    expect(await redirected(installUpdateAction(form({ ref: "v1.1.0", version: "v1.1.0", typed: "1.0.0" })))).toMatch(/^redirect:\/admin\/settings\/updates\?error=.*Type\+the\+version/);
    expect(dispatches()).toHaveLength(0);
    expect(await redirected(installUpdateAction(form({ ref: "v1.1.0", version: "v1.1.0", typed: "1.1.0" })))).toMatch(/^redirect:\/admin\/settings\/updates\?notice=Update\+requested/);
    expect(dispatches()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ action: "install_update", ip: "198.51.100.1" });
  });

  it("rollback: the box must be ticked", async () => {
    expect(await redirected(rollbackAction(form({ reason: "broken" })))).toMatch(/error=Tick/);
    expect(await redirected(rollbackAction(form({ reason: "broken", confirm: "on" })))).toMatch(/notice=Rollback\+requested/);
    expect(audit()[0]).toMatchObject({ action: "rollback_deploy" });
  });

  it("the runs route answers only admins", async () => {
    const ok = await runsRoute();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ runs: [{ id: 1 }], inFlight: null });
    h.requireAdmin.mockRejectedValue(new Error("404"));
    expect((await runsRoute()).status).toBe(404);
  });
});
