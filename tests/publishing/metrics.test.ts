import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  post: { findMany: vi.fn() },
  postMetrics: { create: vi.fn() },
  serviceSwitch: { findMany: vi.fn() },
}));
const connections = vi.hoisted(() => ({ loadCredentials: vi.fn(), markConnectionError: vi.fn() }));
const provider = vi.hoisted(() => ({ metrics: vi.fn() }));
const entitlements = vi.hoisted(() => ({ companyFeatures: vi.fn(), companyEntitlements: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/entitlements", () => entitlements);
vi.mock("@/lib/social/connections", () => connections);
vi.mock("@/lib/social/registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/social/registry")>("@/lib/social/registry");
  return { ...actual, getProvider: () => provider };
});

import { clearSwitchCache } from "@/lib/admin/switch";
import { collectMetrics, MAX_POSTS_PER_ACCOUNT } from "@/lib/publishing/metrics";
import { SocialError } from "@/lib/social/types";

const now = new Date("2026-10-14T05:23:00Z");
const run = () => collectMetrics(now, { pauseMs: 0, budgetMs: 60_000 });
const where = () => (prisma.post.findMany.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;

function post(id: string, connectionId = "c1", network = "instagram") {
  return { id, network, externalId: `x_${id}`, connectionId, businessId: "b1" };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSwitchCache();
  prisma.serviceSwitch.findMany.mockResolvedValue([]);
  prisma.post.findMany.mockResolvedValue([]);
  prisma.postMetrics.create.mockResolvedValue({});
  connections.loadCredentials.mockResolvedValue({ accessToken: "t" });
  connections.markConnectionError.mockResolvedValue(undefined);
  provider.metrics.mockResolvedValue({ views: 10, likes: 2, comments: 1 });
});

describe("collectMetrics: who is read", () => {
  it("reads every publishing business, whatever its plan", async () => {
    await run();
    expect(entitlements.companyFeatures).not.toHaveBeenCalled();
    expect(entitlements.companyEntitlements).not.toHaveBeenCalled();
    expect(JSON.stringify(where())).not.toMatch(/plan|feature|subscription/i);
  });

  it("leaves out accounts that must be reconnected, reminder accounts and posts without an account", async () => {
    await run();
    expect(where()).toMatchObject({ status: "PUBLISHED", externalId: { not: null }, connectionId: { not: null }, connection: { postingMode: "AUTO", status: { notIn: ["EXPIRED", "REVOKED"] } } });
  });

  it("asks only networks and account types that share results, so others do not take the run's places", async () => {
    await run();
    expect(where().OR).toEqual([{ network: "instagram" }, { network: "facebook" }, { network: "youtube" }, { network: "linkedin", connection: { accountType: { in: ["organization"] } } }]);
  });
});

describe("collectMetrics: limits", () => {
  it("reads at most a set number of one account's posts per run and leaves the rest for the next", async () => {
    const many = Array.from({ length: MAX_POSTS_PER_ACCOUNT + 5 }, (_, i) => post(`p${i}`, "busy"));
    prisma.post.findMany.mockResolvedValue([...many, post("other", "c2", "facebook")]);
    const result = await run();
    expect(result).toEqual({ checked: MAX_POSTS_PER_ACCOUNT + 1, saved: MAX_POSTS_PER_ACCOUNT + 1, skipped: 5, failed: 0 });
    expect(prisma.postMetrics.create).toHaveBeenCalledWith({ data: expect.objectContaining({ postId: "other" }) });
  });

  it("stops asking for an account once the network says it is rate limited", async () => {
    prisma.post.findMany.mockResolvedValue([post("a"), post("b"), post("c", "c2")]);
    provider.metrics.mockRejectedValueOnce(new SocialError("Too many calls", "rate_limit", "instagram"));
    const result = await run();
    expect(result).toEqual({ checked: 2, saved: 1, skipped: 1, failed: 1 });
    expect(connections.markConnectionError).not.toHaveBeenCalled();
  });
});

describe("collectMetrics: disconnected accounts", () => {
  it("marks an account whose sign-in stopped working, skips its other posts and goes on with the rest", async () => {
    prisma.post.findMany.mockResolvedValue([post("a"), post("b"), post("c", "c2")]);
    const expired = new SocialError("This account needs to be reconnected", "auth", "instagram");
    connections.loadCredentials.mockImplementation(async (id: string) => {
      if (id === "c1") throw expired;
      return { accessToken: "t" };
    });
    const result = await run();
    expect(result).toEqual({ checked: 2, saved: 1, skipped: 1, failed: 1 });
    expect(connections.markConnectionError).toHaveBeenCalledWith("c1", expired);
    expect(prisma.postMetrics.create).toHaveBeenCalledTimes(1);
  });
});
