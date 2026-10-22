import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  off: [] as string[],
  postFindMany: vi.fn(async () => [] as unknown[]),
  user: { id: "u1", actorId: "u1", businessId: "b1", role: "OWNER", email: "o@example.com" },
  serviceFind: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    serviceSwitch: { findMany: (...a: unknown[]) => h.serviceFind(...a) },
    post: { findMany: h.postFindMany },
    subscription: { findUnique: vi.fn(async () => ({ provider: "PADDLE", providerSubscriptionId: "sub_1", providerCustomerId: "ctm_1", plan: "PRO", status: "ACTIVE" })) },
  },
}));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/require-user")>()),
  requireActiveUser: vi.fn(async () => h.user),
  requirePersonalUser: vi.fn(async () => h.user),
}));
const billing = vi.hoisted(() => ({ cancel: vi.fn(), portal: vi.fn(), invoices: vi.fn(async () => []) }));
vi.mock("@/lib/billing", () => ({
  activeProvider: () => "PADDLE",
  billingAdapter: () => ({ cancelAtPeriodEnd: billing.cancel, resume: billing.cancel, portalUrl: billing.portal, listInvoices: billing.invoices }),
  isInterval: () => true,
  isPaidPlan: () => true,
  priceIdFor: vi.fn(),
}));
vi.mock("@/lib/billing/paddle", () => ({ invoiceUrl: vi.fn() }));
vi.mock("@/lib/billing/apply", () => ({ applyProviderSubscription: vi.fn() }));
vi.mock("@/lib/analytics/queries", () => ({ getOverview: vi.fn(), getMetrics: vi.fn(), getFunnel: vi.fn(), getRevenue: vi.fn(), getCosts: vi.fn(), getProfit: vi.fn(), getTopContent: vi.fn(), getWhatsWorking: vi.fn(), weeklyReport: vi.fn() }));
vi.mock("@/lib/admin/client360", () => ({
  getClient360: vi.fn(async () => ({
    overview: { user: { email: "owner@example.com" } },
    leads: { total: 2, leads: [{ id: "l1", name: "Jane Doe", email: "jane.doe@gmail.com", source: "website_chat", status: "NEW" }, { id: "l2", name: null, email: null, source: "website_chat", status: "NEW" }] },
  })),
}));

import { collectMetrics } from "@/lib/publishing/metrics";
import { cancelSubscription, openPortal, getInvoices, getInvoiceUrl } from "@/app/dashboard/billing/actions";
import { clearSwitchCache, disabledServices } from "@/lib/admin/switch";
import { callTool } from "@/lib/admin/tools";
import { apiContext } from "@/lib/admin/types";

beforeEach(() => {
  vi.clearAllMocks();
  h.off = [];
  // X is off until the owner switches it on (it costs per post): here it is on, so "nothing off" means nothing.
  h.serviceFind.mockImplementation(async () => [...h.off.map((service) => ({ service })), { service: "twitter", enabled: true }]);
  clearSwitchCache();
});
const turnOff = (...ids: string[]) => {
  h.off = ids;
  clearSwitchCache();
};

describe("metrics cron", () => {
  it("skips posts of a network that is switched off and reads everything otherwise", async () => {
    turnOff("meta");
    await collectMetrics(new Date("2026-10-09T05:00:00Z"));
    const where = (h.postFindMany.mock.calls[0] as unknown as [{ where: { network?: { notIn: string[] } } }])[0].where;
    expect(where.network?.notIn.sort()).toEqual(["facebook", "instagram"]);
    turnOff();
    await collectMetrics(new Date("2026-10-09T05:00:00Z"));
    expect((h.postFindMany.mock.calls[1] as unknown as [{ where: object }])[0].where).not.toHaveProperty("network");
  });
});

describe("billing with Paddle off", () => {
  it("cancel, portal and receipts say billing is unavailable and point to support, without calling Paddle", async () => {
    turnOff("paddle");
    const cancel = await cancelSubscription();
    expect(cancel).toMatchObject({ ok: false });
    expect((cancel as { error: string }).error).toMatch(/temporarily unavailable.*contact support.*cancelling/i);
    expect(await openPortal()).toMatchObject({ ok: false, error: expect.stringMatching(/contact support/i) });
    expect(await getInvoices()).toEqual([]);
    expect(await getInvoiceUrl("txn_1")).toMatchObject({ ok: false, error: expect.stringMatching(/contact support/i) });
    expect(billing.cancel).not.toHaveBeenCalled();
    expect(billing.portal).not.toHaveBeenCalled();
    expect(billing.invoices).not.toHaveBeenCalled();
  });

  it("works as before when Paddle is on", async () => {
    billing.cancel.mockResolvedValue({});
    expect(await cancelSubscription()).toEqual({ ok: true });
    expect(billing.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("kill switch cache", () => {
  it("a database outage does not query on every call: the last answer is kept for a full interval", async () => {
    turnOff("canva");
    expect((await disabledServices()).has("canva")).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 20_000); // the cache is stale
    h.serviceFind.mockClear();
    h.serviceFind.mockRejectedValue(new Error("db down"));
    for (let i = 0; i < 5; i++) expect((await disabledServices()).has("canva")).toBe(true); // last good answer
    expect(h.serviceFind).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 20_000);
    await disabledServices();
    expect(h.serviceFind).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("get_client_360 over MCP", () => {
  it("masks the client's own customers (lead names and emails) but not the client", async () => {
    const out = (await callTool("get_client_360", { userId: "11111111-1111-4111-8111-111111111111" }, apiContext("k1", null, "all"))) as { overview: { user: { email: string } }; leads: { leads: { name: string | null; email: string | null }[] } };
    expect(out.leads.leads[0]).toMatchObject({ name: "J***", email: "j***@gmail.com" });
    expect(out.leads.leads[1]).toMatchObject({ name: null, email: null });
    expect(JSON.stringify(out)).not.toContain("jane.doe");
    expect(JSON.stringify(out)).not.toContain("Jane");
    expect(out.overview.user.email).toBe("owner@example.com");
  });
});
