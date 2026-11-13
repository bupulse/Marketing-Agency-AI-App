import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  const adminSetting = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null)),
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
      rows.set(where.key, rows.has(where.key) ? update.value : create.value);
      return {};
    }),
  };
  return { rows, adminSetting, logError: vi.fn(async () => {}) };
});
vi.mock("@/lib/db", () => ({ prisma: { adminSetting: m.adminSetting } }));
vi.mock("@/lib/errors", async (orig) => {
  const real = await orig<typeof import("@/lib/errors")>();
  return { ...real, logError: m.logError };
});

import { activeServiceFault, asFault, clearServiceFault, clearServiceFaultsOf, keyHash, loadServiceFaultIssues, reportServiceFault, resetServiceFaultsForTests, SERVICE_FAULTS_SETTING, type ServiceFault } from "@/lib/admin/service-faults";
import { faultIssues } from "@/lib/admin/service-faults-rules";

beforeEach(() => {
  m.rows.clear();
  m.logError.mockClear();
  m.adminSetting.upsert.mockClear();
  resetServiceFaultsForTests();
});

const stored = () => m.rows.get(SERVICE_FAULTS_SETTING) as Record<string, ServiceFault>;

describe("a refused Composio key is one fault, not an error per call", () => {
  it("writes one warning when it starts and then only counts", async () => {
    for (let i = 0; i < 25; i++) await reportServiceFault("composio:key", "Invalid API key", { apiKey: "ck_old_key" });
    expect(m.logError).toHaveBeenCalledTimes(1);
    expect(m.logError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Invalid API key") }), expect.objectContaining({ source: "service-fault.composio:key", level: "warn" }));
    // Written once, then at most every 10 minutes.
    expect(m.adminSetting.upsert).toHaveBeenCalledTimes(1);
    expect(stored()["composio:key"]).toMatchObject({ key: "composio:key", count: 1, keyHash: keyHash("ck_old_key") });
  });

  it("never keeps the key itself, only a short hash", async () => {
    await reportServiceFault("composio:key", "Invalid API key", { apiKey: "ck_secret_value_123" });
    expect(JSON.stringify(m.rows.get(SERVICE_FAULTS_SETTING))).not.toContain("ck_secret_value_123");
  });

  it("applies only to the key that was refused: a newly pasted key goes through", async () => {
    await reportServiceFault("composio:key", "Invalid API key", { apiKey: "ck_old_key" });
    expect(await activeServiceFault("composio:key", { apiKey: "ck_old_key" })).not.toBeNull();
    expect(await activeServiceFault("composio:key", { apiKey: "ck_new_key" })).toBeNull();
  });

  it("a new key refused too is a new fault with its own warning", async () => {
    await reportServiceFault("composio:key", "Invalid API key", { apiKey: "ck_old_key" });
    await reportServiceFault("composio:key", "Invalid API key", { apiKey: "ck_new_key" });
    expect(m.logError).toHaveBeenCalledTimes(2);
  });

  it("is cleared by a good answer or a passing Test now", async () => {
    await reportServiceFault("composio:key", "Invalid API key", { apiKey: "k" });
    await clearServiceFault("composio:key");
    expect(stored()["composio:key"]).toBeUndefined();
    await reportServiceFault("composio:key", "Invalid API key", { apiKey: "k" });
    await clearServiceFaultsOf("composio");
    expect(stored()["composio:key"]).toBeUndefined();
  });

  it("errors marked as a recorded fault are left out of Admin -> Errors by logError itself", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/errors");
    const create = vi.fn(async () => ({}));
    vi.doMock("@/lib/db", () => ({ prisma: { errorLog: { create } } }));
    const { logError } = await import("@/lib/errors");
    await logError(asFault(new Error("BuPulse-Socials is paused"), "composio:key"), { source: "social.inbox" });
    expect(create).not.toHaveBeenCalled();
    await logError(new Error("something else"), { source: "social.inbox" });
    expect(create).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/db");
  });
});

describe("Admin -> Health items", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const fault = (over: Partial<ServiceFault>): ServiceFault => ({ key: "composio:key", since: "2026-11-13T08:00:00Z", lastAt: "2026-11-13T11:59:00Z", count: 40, detail: "Invalid API key", keyHash: "abc", until: null, ...over });

  it("a refused key is a problem that says where to paste the new key", () => {
    const [issue] = faultIssues([fault({})], now);
    expect(issue).toMatchObject({ level: "problem", key: "fault:composio:key", href: "/admin/services/composio" });
    expect(issue.text).toContain("Paste a new key on the Composio card");
    expect(issue.text).toContain("40 calls stopped");
  });

  it("the Upload-Post profile limit is a warning about companies that cannot connect, and goes after a week", () => {
    const [issue] = faultIssues([fault({ key: "uploadpost:profile-limit", count: 3 })], now);
    expect(issue).toMatchObject({ level: "warning", key: "fault:uploadpost:profile-limit" });
    expect(issue.text).toContain("could not connect LinkedIn or TikTok");
    expect(faultIssues([fault({ key: "uploadpost:profile-limit", lastAt: "2026-11-01T00:00:00Z" })], now)).toEqual([]);
  });

  it("a plan limit that has passed is not shown", () => {
    expect(faultIssues([fault({ key: "uploadpost:plan-limit", until: "2026-11-13T11:00:00Z" })], now)).toEqual([]);
    expect(faultIssues([fault({ key: "uploadpost:plan-limit", until: "2026-11-13T18:00:00Z" })], now)).toHaveLength(1);
  });

  it("loads what is recorded", async () => {
    await reportServiceFault("uploadpost:key", "Unauthorized", { apiKey: "u" });
    expect((await loadServiceFaultIssues()).map((i) => i.key)).toEqual(["fault:uploadpost:key"]);
  });
});
