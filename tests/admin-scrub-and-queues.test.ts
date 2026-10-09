import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Record<string, unknown>[] = [];
const calls: { model: string; method: string; args: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
const defaults: Record<string, unknown> = { findMany: [], groupBy: [], count: 0, findFirst: null, findUnique: null, $queryRaw: [] };

vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    { $queryRaw: async () => [] },
    {
      get: (t, model: string) => {
        if (model in t) return (t as Record<string, unknown>)[model];
        return new Proxy({}, {
          get: (_u, method: string) => async (args: Record<string, any> = {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            calls.push({ model, method, args });
            if (model === "cronRun" && method === "create") { created.push(args.data); return {}; }
            return defaults[method] ?? null;
          },
        });
      },
    },
  ),
}));
vi.mock("@/lib/admin/service", () => ({ APPROVAL_TTL_MS: 7 * 86_400_000 }));
vi.mock("@/lib/admin/switch", () => ({ disabledNetworks: async () => ["instagram", "facebook"] }));

const SECRET = "sk-abcdefghijklmnopqrstuvwxyz123456";
beforeEach(() => { created.length = 0; calls.length = 0; });

describe("cron run records are scrubbed", () => {
  it("removes secrets from the summary and the error before saving", async () => {
    const { recordCron } = await import("@/lib/admin/cron-run");
    await recordCron("metrics", async () => ({ ok: true, note: `called with Bearer abcdefghijklmnop and ${SECRET}` }));
    await expect(recordCron("publish", async () => { throw new Error(`failed https://x.test/?api_key=hunter2hunter2 ${SECRET}`); })).rejects.toThrow();
    const text = JSON.stringify(created);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("hunter2hunter2");
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).toContain("[redacted]");
  });
});

describe("late posts do not include posts held on purpose", () => {
  it("skips switched-off networks, needs-reconnect notes and retries set for later", async () => {
    const { getSystemHealth } = await import("@/lib/admin/health");
    await getSystemHealth(new Date("2026-10-09T12:00:00Z"));
    const q = calls.find((c) => c.model === "post" && c.method === "count" && c.args.where?.status === "SCHEDULED")!;
    const where = q.args.where;
    expect(where.network).toEqual({ notIn: ["instagram", "facebook"] });
    expect(JSON.stringify(where.AND)).toContain("nextAttemptAt");
    expect(JSON.stringify(where.AND)).toContain("Needs reconnect:");
  });
});
