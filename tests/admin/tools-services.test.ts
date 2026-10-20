import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  getAiUsage: vi.fn(async () => ({ month: "2026-10", spentUsd: 1.5 })),
  health: vi.fn(async () => ({ status: "ok", issues: [] })),
  activity: vi.fn(async () => ({ items: [], nextCursor: null })),
  client360: vi.fn(async () => ({ overview: {} })),
  channels: vi.fn(async () => ({ items: [], nextCursor: null })),
  clientConns: vi.fn(async () => ({ channels: [] })),
  forceDisconnect: vi.fn(async () => ({ status: "REVOKED" })),
  listPlans: vi.fn(async () => ({ paddleConnected: true, plans: [{ key: "PRO" }] })),
  companyList: vi.fn(async () => ({ items: [], nextCursor: null })),
  companyUser: vi.fn(async () => ({ ok: true })),
  updatePlan: vi.fn(async () => ({ applied: { changed: ["name"], warnings: [] }, priceChangeApproval: null })),
}));
vi.mock("@/lib/admin/actions/companies", () => ({ listCompanies: h.companyList, getCompany: vi.fn(), createCompanyUser: h.companyUser, changeUserEmail: h.companyUser, sendPasswordReset: h.companyUser, removeCompanyUser: h.companyUser, changeCompanyUserRole: h.companyUser }));
vi.mock("@/lib/admin/service", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/service")>()), listPlansForTools: h.listPlans, updatePlanFromTool: h.updatePlan }));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle", () => ({ paddle: {}, paddleApi: vi.fn() }));
vi.mock("@/lib/analytics/queries", () => ({ getOverview: vi.fn(), getMetrics: vi.fn(), getFunnel: vi.fn(), getRevenue: vi.fn(), getCosts: vi.fn(), getProfit: vi.fn(), getTopContent: vi.fn(), getWhatsWorking: vi.fn(), weeklyReport: vi.fn() }));
vi.mock("@/lib/admin/health", () => ({ getSystemHealth: h.health }));
vi.mock("@/lib/admin/activity", () => ({ getActivity: h.activity }));
vi.mock("@/lib/admin/client360", () => ({ getClient360: h.client360 }));
vi.mock("@/lib/admin/connections", () => ({ listChannels: h.channels, getClientConnections: h.clientConns }));
vi.mock("@/lib/admin/actions/connections", () => ({ forceDisconnectChannel: h.forceDisconnect }));
vi.mock("@/lib/admin/ai-usage", async (orig) => ({ ...(await orig<typeof import("@/lib/admin/ai-usage")>()), getAiUsage: h.getAiUsage }));

import { callTool, inputSchemaOf, TOOLS, findTool } from "@/lib/admin/tools";
import { handleMessage } from "@/lib/admin/mcp";
import { clearSwitchCache, isServiceEnabled } from "@/lib/admin/switch";
import { clearBudgetCache, effectiveBudgetUsd } from "@/lib/ai/budget";
import { apiContext } from "@/lib/admin/types";

const API = apiContext("key1", "203.0.113.5", "all");
const call = (name: string, args: unknown) => callTool(name, args, API);
const failure = async (name: string, args: unknown) => call(name, args).then(() => null, (e: { code: string }) => e.code);

beforeEach(() => {
  h.db = createFakeDb();
  vi.clearAllMocks();
  clearSwitchCache();
  clearBudgetCache();
});

describe("new Jarvis tools", () => {
  it("are listed with descriptions and schemas, and the risky ones say so", async () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of ["list_services", "test_service", "set_service_enabled", "get_ai_usage", "set_ai_budget", "get_system_health", "get_activity", "get_client_360", "list_connections", "force_disconnect_channel", "disconnect_connector", "revoke_client_api_key", "switch_off_widget", "switch_on_widget"]) {
      expect(names).toContain(n);
      expect(findTool(n)!.description.length).toBeGreaterThan(40);
      expect(inputSchemaOf(findTool(n)!).type).toBe("object");
    }
    expect(findTool("set_service_enabled")!.description).toMatch(/confirm: true/);
    expect(inputSchemaOf(findTool("set_service_enabled")!).required).toEqual(expect.arrayContaining(["service", "enabled"]));
    expect((inputSchemaOf(findTool("test_service")!).properties as { service: { enum: string[] } }).service.enum).toContain("gemini");
    const list = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, API);
    const annotated = (list as { result: { tools: { name: string; annotations: Record<string, boolean> }[] } }).result.tools;
    expect(annotated.find((t) => t.name === "set_service_enabled")!.annotations.destructiveHint).toBe(true);
    expect(annotated.find((t) => t.name === "list_services")!.annotations.readOnlyHint).toBe(true);
  });

  it("list_services returns the registry without any secret value", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyFAKE-tool-secret-0001";
    const out = (await call("list_services", {})) as { id: string; env: { name: string; set: boolean }[] }[];
    expect(out.map((s) => s.id)).toContain("gemini");
    expect(JSON.stringify(out)).not.toContain("AIzaSyFAKE-tool-secret-0001");
    expect(out.find((s) => s.id === "gemini")!.env[0]).toEqual({ name: "GEMINI_API_KEY", set: true, source: "host", shown: null, savedAt: null, savedBy: null, hostSet: true });
  });

  it("set_service_enabled works through the tool: confirm and reason enforced, audited, effective", async () => {
    expect(await failure("set_service_enabled", { service: "resend", enabled: false, reason: "quota" })).toBe("confirm_required");
    expect(await failure("set_service_enabled", { service: "resend", enabled: false, confirm: true })).toBe("invalid");
    expect(await failure("set_service_enabled", { service: "nope", enabled: false, confirm: true })).toBe("invalid");
    expect(await failure("set_service_enabled", { service: "supabase", enabled: false, reason: "x y z", confirm: true })).toBe("forbidden");
    const out = await call("set_service_enabled", { service: "resend", enabled: false, reason: "quota used up", confirm: true });
    expect(out).toMatchObject({ service: "resend", enabled: false });
    expect(await isServiceEnabled("resend")).toBe(false);
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ actor: "jarvis:key1", action: "set_service_enabled", target: "service:resend" });
    await call("set_service_enabled", { service: "resend", enabled: true });
    expect(await isServiceEnabled("resend")).toBe(true);
  });

  it("test_service runs the check and records it", async () => {
    delete process.env.DROPBOX_APP_KEY;
    const out = (await call("test_service", { service: "dropbox" })) as { ok: boolean; message: string };
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/DROPBOX_APP_KEY/);
    expect(h.db.serviceCheck.rows[0]).toMatchObject({ service: "dropbox", ok: false });
  });

  it("set_ai_budget needs confirm, changes the cap and audits it; get_ai_usage passes its arguments through", async () => {
    expect(await failure("set_ai_budget", { monthlyUsd: 40 })).toBe("confirm_required");
    expect(await failure("set_ai_budget", { monthlyUsd: 40, confirm: false })).toBe("confirm_required");
    expect(await failure("set_ai_budget", { monthlyUsd: 99999, confirm: true })).toBe("invalid");
    expect(await call("set_ai_budget", { monthlyUsd: 40, confirm: true })).toEqual({ monthlyUsd: 40, source: "admin" });
    expect(await effectiveBudgetUsd()).toBe(40);
    expect(h.db.auditLog.rows.at(-1)).toMatchObject({ action: "set_ai_budget" });
    expect(await call("get_ai_usage", { month: "2026-10", topLimit: 5 })).toEqual({ month: "2026-10", spentUsd: 1.5 });
    expect(h.getAiUsage).toHaveBeenCalledWith({ month: "2026-10", topLimit: 5 });
    expect(await failure("get_ai_usage", { month: "October" })).toBe("invalid");
  });

  it("the read tools from the health, activity, Client 360 and connections work call the new modules", async () => {
    await call("get_system_health", {});
    await call("get_activity", { limit: 5, types: ["errors"] });
    await call("get_client_360", { userId: "11111111-1111-4111-8111-111111111111" });
    await call("list_connections", { kind: "channels", network: "facebook", limit: 10 });
    await call("list_connections", { kind: "client", businessId: "b1" });
    expect(h.health).toHaveBeenCalled();
    expect(h.activity).toHaveBeenCalledWith({ limit: 5, types: ["errors"] });
    expect(h.client360).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(h.channels).toHaveBeenCalledWith(expect.objectContaining({ network: "facebook", limit: 10 }));
    expect(h.clientConns).toHaveBeenCalledWith("b1");
    expect(await failure("list_connections", { kind: "client" })).toBe("invalid");
    expect(await failure("list_connections", { kind: "nope" })).toBe("invalid");
  });

  it("connection actions run with the API context and pass confirm through", async () => {
    await call("force_disconnect_channel", { connectionId: "c1", reason: "abuse", confirm: true });
    expect(h.forceDisconnect).toHaveBeenCalledWith(expect.objectContaining({ actor: "jarvis:key1", viaApi: true }), { connectionId: "c1", reason: "abuse", confirm: true });
    expect(await failure("force_disconnect_channel", { connectionId: "c1" })).toBe("confirm_required");
  });

  it("list_plans and update_plan: confirm and idempotency key enforced, arguments passed to the plans service", async () => {
    expect(findTool("update_plan")!.kind).toBe("money");
    expect(findTool("update_plan")!.description).toMatch(/approval/i);
    expect(await call("list_plans", {})).toEqual({ paddleConnected: true, plans: [{ key: "PRO" }] });
    expect(await failure("update_plan", { plan: "PRO", name: "Pro+" })).toBe("confirm_required");
    expect(await failure("update_plan", { plan: "PRO", monthlyPriceCents: 12900, confirm: true })).toBe("idempotency_required");
    expect(h.updatePlan).not.toHaveBeenCalled();
    await call("update_plan", { plan: "PRO", name: "Pro+", limits: { text: 400 }, confirm: true });
    expect(h.updatePlan).toHaveBeenCalledWith(expect.objectContaining({ actor: "jarvis:key1", viaApi: true }), { plan: "PRO", name: "Pro+", limits: { text: 400 }, confirm: true });
    await call("update_plan", { plan: "PRO", monthlyPriceCents: 12900, confirm: true, idempotencyKey: "plan-price-0001" });
    expect(h.updatePlan).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ monthlyPriceCents: 12900, idempotencyKey: "plan-price-0001" }));
    expect(await failure("update_plan", { plan: "PRO", status: "deleted", confirm: true })).toBe("invalid");
  });

  it("company tools exist, say which are sensitive, and run with the API context (confirm is required)", async () => {
    for (const n of ["list_companies", "get_company", "create_company_user", "change_user_email", "send_password_reset", "remove_company_user", "change_company_user_role"]) expect(findTool(n)).toBeTruthy();
    expect(findTool("create_company_user")!.description).toMatch(/SENSITIVE/);
    expect(findTool("create_company_user")!.description).toMatch(/NO password/);
    expect(findTool("change_user_email")!.description).toMatch(/SENSITIVE/);
    await call("list_companies", { q: "bakery", limit: 5 });
    expect(h.companyList).toHaveBeenCalledWith({ q: "bakery", limit: 5 });
    expect(await failure("change_user_email", { userId: "u1", newEmail: "new@example.com", idempotencyKey: "email-key-0001" })).toBe("confirm_required");
    expect(await failure("remove_company_user", { userId: "u1" })).toBe("confirm_required");
    expect(await failure("create_company_user", { businessId: "b1", email: "not-an-email", role: "MEMBER", confirm: true })).toBe("invalid");
    expect(await failure("create_company_user", { businessId: "b1", email: "a@example.com", role: "OWNER", confirm: true })).toBe("invalid");
    await call("change_company_user_role", { userId: "u1", role: "OWNER", confirm: true });
    expect(h.companyUser).toHaveBeenCalledWith(expect.objectContaining({ actor: "jarvis:key1", viaApi: true }), { userId: "u1", role: "OWNER", confirm: true });
  });
});
