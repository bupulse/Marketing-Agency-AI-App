import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";

vi.hoisted(() => {
  process.env.API_KEY_PEPPER = "test-pepper-for-admin-keys";
});

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, rateLimit: vi.fn(async () => {}), overview: vi.fn(), weekly: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: h.rateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { updateUserById: async () => ({ error: null }), getUserById: async () => ({ data: { user: null } }) } } }) }));
vi.mock("@/lib/billing/paddle-admin", () => ({ createRefund: vi.fn(), describeRefundTarget: vi.fn(async () => ({ transactionId: "txn_1", currency: "USD", totalMinor: 4900, status: "completed", billedAt: null, lines: [{ id: "txnitm_1", totalMinor: 4900 }] })) }));
vi.mock("@/lib/analytics/queries", () => ({
  getOverview: h.overview,
  getMetrics: vi.fn(async () => ({})),
  getFunnel: vi.fn(),
  getRevenue: vi.fn(),
  getCosts: vi.fn(),
  getProfit: vi.fn(),
  getTopContent: vi.fn(),
  getWhatsWorking: vi.fn(),
  weeklyReport: h.weekly,
}));

import { hashApiKey, legacyHashApiKey } from "@/lib/api/keys";
import { authenticateAdminRequest } from "@/lib/admin/api-auth";
import { createAdminKey, generateAdminKey, ipAllowed, revokeAdminKey, rotateAdminKey } from "@/lib/admin/keys";
import { handleMcpPost, methodNotAllowed } from "@/lib/admin/mcp";
import { callTool, TOOL_NAMES, resolveRange } from "@/lib/admin/tools";
import { RateLimitError } from "@/lib/rate-limit";
import { consoleContext } from "@/lib/admin/types";
import { POST as restPost, GET as restGet } from "@/app/api/admin/v1/[...path]/route";

const USER = "11111111-1111-4111-8111-111111111111";
let KEY = "";
let KEY_ID = "";

async function addKey(ipAllowList: string[] = [], over: Record<string, unknown> = {}) {
  const { key, prefix } = generateAdminKey();
  const row: Record<string, unknown> = await h.db.adminApiKey.create({ data: { id: `k${h.db.adminApiKey.rows.length + 1}`, name: "Jarvis", prefix, hash: await hashApiKey(key), ipAllowList, lastUsedAt: null, revokedAt: null, ...over } });
  return { key, id: row.id as string };
}
const req = (key: string | null, init: { ip?: string; method?: string; body?: unknown; headers?: Record<string, string>; url?: string } = {}) =>
  new Request(init.url ?? "https://bupulse.test/api/mcp", {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.ip ? { "cf-connecting-ip": init.ip } : {}), ...init.headers },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", id, method, params });
async function mcp(body: unknown, key = KEY) {
  const res = await handleMcpPost(req(key, { body }));
  return { res, json: res.status === 202 ? null : await res.json() };
}

beforeEach(async () => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  const k = await addKey();
  KEY = k.key;
  KEY_ID = k.id;
});

describe("admin key authentication", () => {
  it("accepts a valid key and records last use", async () => {
    const auth = await authenticateAdminRequest(req(KEY));
    expect(auth.ok && auth.ctx).toMatchObject({ actor: `jarvis:${KEY_ID}`, viaApi: true });
    expect(h.db.adminApiKey.rows[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it.each([
    ["no header", null],
    ["wrong prefix", "bp_live_abcdef"],
    ["unknown key", "bpj_live_" + "x".repeat(43)],
  ])("rejects %s with 401", async (_n, key) => {
    const auth = await authenticateAdminRequest(req(key));
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(401);
      expect((await auth.response.json()).error.code).toBe("unauthorized");
    }
  });

  it("accepts a key stored with the old unpeppered hash and rehashes it to the peppered one", async () => {
    h.db.adminApiKey.rows[0].hash = await legacyHashApiKey(KEY);
    const auth = await authenticateAdminRequest(req(KEY));
    expect(auth.ok).toBe(true);
    expect(h.db.adminApiKey.rows[0].hash).toBe(await hashApiKey(KEY));
    expect(await hashApiKey(KEY)).not.toBe(await legacyHashApiKey(KEY));
  });

  it("rejects a revoked key", async () => {
    h.db.adminApiKey.rows[0].revokedAt = new Date();
    const auth = await authenticateAdminRequest(req(KEY));
    expect(!auth.ok && auth.response.status).toBe(401);
  });

  it("enforces the IP allow-list (exact and CIDR) using cf-connecting-ip", async () => {
    const k = await addKey(["203.0.113.7", "198.51.100.0/24", "2001:db8::1"]);
    const status = async (ip?: string) => {
      const a = await authenticateAdminRequest(req(k.key, { ip }));
      return a.ok ? 200 : a.response.status;
    };
    expect(await status("203.0.113.7")).toBe(200);
    expect(await status("198.51.100.200")).toBe(200);
    expect(await status("2001:db8::1")).toBe(200);
    expect(await status("198.51.101.1")).toBe(403);
    expect(await status("203.0.113.8")).toBe(403);
    expect(await status(undefined)).toBe(403);
    const denied = await authenticateAdminRequest(req(k.key, { ip: "1.2.3.4" }));
    expect(!denied.ok && (await denied.response.json()).error.code).toBe("ip_not_allowed");
    // a key without a list works from anywhere
    expect((await authenticateAdminRequest(req(KEY, { ip: "1.2.3.4" }))).ok).toBe(true);
  });

  it("ipAllowed handles bad input safely", () => {
    expect(ipAllowed("999.1.1.1", ["10.0.0.0/8"])).toBe(false);
    expect(ipAllowed("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipAllowed("10.1.2.3", [])).toBe(true);
    expect(ipAllowed(null, [])).toBe(true);
  });

  it("answers 429 with retry-after when the per-key limit is hit", async () => {
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(17));
    const auth = await authenticateAdminRequest(req(KEY));
    expect(!auth.ok && auth.response.status).toBe(429);
    expect(!auth.ok && auth.response.headers.get("retry-after")).toBe("17");
    expect(h.rateLimit).toHaveBeenCalledWith(`admin-key:${KEY_ID}`, expect.objectContaining({ limit: 120 }));
  });
});

describe("key management", () => {
  it("creates a key shown once, stores only the hash, validates the allow-list and audits", async () => {
    const { key, apiKey } = await createAdminKey(consoleContext(), { name: "Jarvis prod", ipAllowList: ["203.0.113.0/24"] });
    expect(key.startsWith("bpj_live_")).toBe(true);
    const stored = h.db.adminApiKey.rows.find((r) => r.id === apiKey.id)!;
    expect(stored.hash).toBe(await hashApiKey(key));
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(JSON.stringify(h.db.auditLog.rows)).not.toContain(key);
    await expect(createAdminKey(consoleContext(), { name: "x", ipAllowList: ["not-an-ip"] })).rejects.toMatchObject({ code: "invalid" });
    await expect(createAdminKey(consoleContext(), { name: " " })).rejects.toMatchObject({ code: "invalid" });
  });

  it("rotate gives a working new key and kills the old one; revoke kills a key", async () => {
    const { key: newKey } = await rotateAdminKey(consoleContext(), KEY_ID);
    expect((await authenticateAdminRequest(req(KEY))).ok).toBe(false);
    expect((await authenticateAdminRequest(req(newKey))).ok).toBe(true);
    const id2 = h.db.adminApiKey.rows.find((r) => !r.revokedAt)!.id;
    await revokeAdminKey(consoleContext(), id2);
    expect((await authenticateAdminRequest(req(newKey))).ok).toBe(false);
    expect(h.db.auditLog.rows.map((a) => a.action)).toEqual(["rotate_admin_key", "revoke_admin_key"]);
  });
});

describe("MCP over Streamable HTTP", () => {
  it("initialize negotiates the version and advertises tools", async () => {
    const { res, json } = await mcp(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "jarvis", version: "1" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(json).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "bupulse-admin" } } });
    expect(typeof json.result.instructions).toBe("string");
    const unknown = await mcp(rpc("initialize", { protocolVersion: "1999-01-01" }));
    expect(unknown.json.result.protocolVersion).toBe("2025-11-25");
  });

  it("tools/list returns every tool with description and a JSON schema", async () => {
    const { json } = await mcp(rpc("tools/list"));
    const tools = json.result.tools as { name: string; description: string; inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] }; annotations: Record<string, boolean> }[];
    const names = tools.map((t) => t.name);
    for (const n of ["get_overview", "get_metrics", "get_funnel", "get_revenue", "get_costs", "get_profit", "list_users", "get_user", "get_business", "list_posts", "get_top_content", "get_whats_working", "get_errors", "get_audit_log", "weekly_report", "extend_trial", "change_plan", "issue_refund", "suspend_user", "restore_user", "set_feature_flag", "send_announcement", "update_plan_limits", "rerun_failed_post", "get_approval"]) {
      expect(names).toContain(n);
    }
    expect(names.sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(30);
      expect(t.inputSchema.type).toBe("object");
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.issue_refund.description).toMatch(/approval request/i);
    expect(byName.issue_refund.description).toMatch(/console/i);
    expect(byName.change_plan.description).toMatch(/console/i);
    expect(byName.issue_refund.inputSchema.required).toEqual(expect.arrayContaining(["userId", "reason", "idempotencyKey"]));
    expect(byName.suspend_user.inputSchema.required).toContain("confirm");
    expect(byName.get_overview.annotations.readOnlyHint).toBe(true);
    expect(byName.suspend_user.annotations.destructiveHint).toBe(true);
  });

  it("tools/call runs a read tool and returns text + structured content", async () => {
    h.overview.mockResolvedValue({ visits: 12, signups: 3 });
    const { json } = await mcp(rpc("tools/call", { name: "get_overview", arguments: { days: 7 } }));
    expect(json.result.isError).toBe(false);
    expect(json.result.content[0].type).toBe("text");
    expect(JSON.parse(json.result.content[0].text)).toEqual({ visits: 12, signups: 3 });
    expect(json.result.structuredContent).toEqual({ visits: 12, signups: 3 });
    const range = h.overview.mock.calls[0][0];
    expect(range.to >= range.from).toBe(true);
  });

  it("every tools/call is one rate-limited request", async () => {
    h.overview.mockResolvedValue({});
    h.rateLimit.mockClear();
    for (let i = 0; i < 3; i++) await mcp(rpc("tools/call", { name: "get_overview", arguments: {} }, i + 1));
    expect(h.rateLimit).toHaveBeenCalledTimes(3);
  });

  it("tools/call extend_trial changes data and writes an audit row attributed to the key", async () => {
    h.db.user.rows.push({ id: USER, email: "u@example.com" });
    h.db.subscription.rows.push({ id: "s1", userId: USER, plan: "TRIAL", status: "TRIALING", trialEndsAt: new Date(Date.now() + 86_400_000) });
    const { json } = await mcp(rpc("tools/call", { name: "extend_trial", arguments: { userId: USER, days: 5 } }));
    expect(json.result.isError).toBe(false);
    const audit = h.db.auditLog.rows.at(-1)!;
    expect(audit).toMatchObject({ actor: `jarvis:${KEY_ID}`, action: "extend_trial", target: `user:${USER}` });
    expect(audit.before).toBeTruthy();
    expect(audit.after).toBeTruthy();
  });

  it("a money tool creates an approval and says so; replay returns the same id", async () => {
    h.db.user.rows.push({ id: USER, email: "u@example.com" });
    h.db.subscription.rows.push({ id: "s1", userId: USER, plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", providerCustomerId: "ctm_1", providerSubscriptionId: "sub_1" });
    const args = { userId: USER, reason: "double charge", idempotencyKey: "mcp-refund-0001" };
    const a = await mcp(rpc("tools/call", { name: "issue_refund", arguments: args }));
    const b = await mcp(rpc("tools/call", { name: "issue_refund", arguments: args }));
    expect(a.json.result.structuredContent).toMatchObject({ status: "pending", kind: "issue_refund", replayed: false });
    expect(b.json.result.structuredContent).toMatchObject({ replayed: true, id: a.json.result.structuredContent.id });
    expect(h.db.adminApproval.rows).toHaveLength(1);
    const got = await mcp(rpc("tools/call", { name: "get_approval", arguments: { id: a.json.result.structuredContent.id } }));
    expect(got.json.result.structuredContent).toMatchObject({ status: "pending", requestedBy: `jarvis:${KEY_ID}` });
  });

  it("tool failures are results with isError, not protocol errors", async () => {
    const missingKey = await mcp(rpc("tools/call", { name: "issue_refund", arguments: { userId: USER, reason: "x" } }));
    expect(missingKey.json.result.isError).toBe(true);
    expect(missingKey.json.result.content[0].text).toMatch(/^idempotency_required:/);
    const noConfirm = await mcp(rpc("tools/call", { name: "suspend_user", arguments: { userId: USER } }));
    expect(noConfirm.json.result.isError).toBe(true);
    expect(noConfirm.json.result.content[0].text).toMatch(/^confirm_required:/);
    const falseConfirm = await mcp(rpc("tools/call", { name: "update_plan_limits", arguments: { plan: "PRO", limits: { text: 1 }, confirm: false } }));
    expect(falseConfirm.json.result.content[0].text).toMatch(/^confirm_required:/);
    const bad = await mcp(rpc("tools/call", { name: "extend_trial", arguments: { userId: USER, days: "many" } }));
    expect(bad.json.result.content[0].text).toMatch(/^invalid:/);
    const missing = await mcp(rpc("tools/call", { name: "get_user", arguments: { userId: USER } }));
    expect(missing.json.result.content[0].text).toMatch(/^not_found:/);
  });

  it("protocol errors: unknown tool, unknown method, bad JSON, invalid request, empty batch", async () => {
    expect((await mcp(rpc("tools/call", { name: "nope", arguments: {} }))).json.error).toMatchObject({ code: -32602 });
    expect((await mcp(rpc("tools/call", {}))).json.error.code).toBe(-32602);
    expect((await mcp(rpc("resources/list"))).json.error).toMatchObject({ code: -32601 });
    const parse = await handleMcpPost(req(KEY, { body: "{not json" }));
    expect(parse.status).toBe(400);
    expect((await parse.json()).error.code).toBe(-32700);
    expect((await mcp({ hello: "world" })).json.error.code).toBe(-32600);
    const empty = await handleMcpPost(req(KEY, { body: [] }));
    expect(empty.status).toBe(400);
  });

  it("ping works, notifications get 202 with no body, batches are refused", async () => {
    expect((await mcp(rpc("ping"))).json.result).toEqual({});
    const note = await handleMcpPost(req(KEY, { body: { jsonrpc: "2.0", method: "notifications/initialized" } }));
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");
    // batches are refused, so one HTTP request can never run more than one tool call
    const batch = await handleMcpPost(req(KEY, { body: Array.from({ length: 50 }, (_, i) => rpc("tools/call", { name: "get_overview", arguments: {} }, i + 1)) }));
    expect(batch.status).toBe(400);
    expect((await batch.json()).error.code).toBe(-32600);
    expect(h.overview).not.toHaveBeenCalled();
  });

  it("requires the bearer key (401 JSON), honours the IP list and rejects foreign browser origins", async () => {
    const none = await handleMcpPost(req(null, { body: rpc("ping") }));
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    const k = await addKey(["203.0.113.7"]);
    expect((await handleMcpPost(req(k.key, { body: rpc("ping"), ip: "1.1.1.1" }))).status).toBe(403);
    expect((await handleMcpPost(req(k.key, { body: rpc("ping"), ip: "203.0.113.7" }))).status).toBe(200);
    const evil = await handleMcpPost(req(KEY, { body: rpc("ping"), headers: { origin: "https://evil.example" } }));
    expect(evil.status).toBe(403);
    const same = await handleMcpPost(req(KEY, { body: rpc("ping"), headers: { origin: "https://bupulse.test" } }));
    expect(same.status).toBe(200);
  });

  it("GET and DELETE are 405 with Allow: POST", async () => {
    const res = methodNotAllowed();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("REST API", () => {
  const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });

  it("lists tools, runs an action by POST and a read by GET with query coercion", async () => {
    h.overview.mockResolvedValue({ ok: true });
    const list = await restGet(req(KEY, { method: "GET", url: "https://bupulse.test/api/admin/v1/tools" }), ctx("tools"));
    expect((await list.json()).tools.length).toBe(TOOL_NAMES.length);
    const get = await restGet(req(KEY, { method: "GET", url: "https://bupulse.test/api/admin/v1/overview?days=30" }), ctx("overview"));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ result: { ok: true } });
    const flag = await restPost(req(KEY, { url: "https://bupulse.test/api/admin/v1/tools/set_feature_flag", body: { key: "beta", enabled: true } }), ctx("tools", "set_feature_flag"));
    expect(flag.status).toBe(200);
    expect(h.db.featureFlag.rows[0]).toMatchObject({ key: "beta", enabled: true });
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ actor: `jarvis:${KEY_ID}`, action: "set_feature_flag" });
  });

  it("returns JSON errors with the right status", async () => {
    const noAuth = await restPost(req(null, { url: "https://bupulse.test/api/admin/v1/tools/set_feature_flag", body: {} }), ctx("tools", "set_feature_flag"));
    expect(noAuth.status).toBe(401);
    const noConfirm = await restPost(req(KEY, { url: "https://bupulse.test/api/admin/v1/tools/suspend_user", body: { userId: USER } }), ctx("tools", "suspend_user"));
    expect(noConfirm.status).toBe(400);
    expect((await noConfirm.json()).error.code).toBe("confirm_required");
    const noIdem = await restPost(req(KEY, { url: "https://bupulse.test/api/admin/v1/tools/issue_refund", body: { userId: USER, reason: "x" } }), ctx("tools", "issue_refund"));
    expect((await noIdem.json()).error.code).toBe("idempotency_required");
    const unknown = await restPost(req(KEY, { url: "https://bupulse.test/api/admin/v1/tools/nope", body: {} }), ctx("tools", "nope"));
    expect(unknown.status).toBe(404);
    const badJson = await restPost(req(KEY, { url: "https://bupulse.test/api/admin/v1/tools/extend_trial", body: "{oops" }), ctx("tools", "extend_trial"));
    expect(badJson.status).toBe(400);
    const getAction = await restGet(req(KEY, { method: "GET", url: "https://bupulse.test/api/admin/v1/tools/suspend_user" }), ctx("tools", "suspend_user"));
    expect(getAction.status).toBe(405);
    const nf = await restGet(req(KEY, { method: "GET", url: "https://bupulse.test/api/admin/v1/users/" + USER }), ctx("users", USER));
    expect(nf.status).toBe(404);
  });
});

describe("tool helpers", () => {
  it("resolveRange defaults to the last 7 days and validates", () => {
    expect(resolveRange({ to: "2026-10-08" })).toEqual({ from: "2026-10-02", to: "2026-10-08" });
    expect(resolveRange({ from: "2026-09-01", to: "2026-09-30" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(() => resolveRange({ from: "2026-10-09", to: "2026-10-08" })).toThrow();
  });

  it("callTool returns plain JSON", async () => {
    h.overview.mockResolvedValue({ at: new Date("2026-10-08T00:00:00Z") });
    expect(await callTool("get_overview", {}, { actor: "x", viaApi: true })).toEqual({ at: "2026-10-08T00:00:00.000Z" });
  });
});
