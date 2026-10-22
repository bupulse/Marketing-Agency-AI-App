import { beforeEach, describe, expect, it, vi } from "vitest";

// Saving a creator's connected account (lib/creators/connections.ts) keeps the follower count the sign-in read, so the
// company sees "Verified" or the difference (docs/CREATOR_CAMPAIGN_WIZARD.md, "Followers").

const h = vi.hoisted(() => ({ findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({ id: "conn1" })) }));
vi.mock("@/lib/db", () => ({ prisma: { creatorConnection: { findUnique: h.findUnique, upsert: h.upsert, count: vi.fn(async () => 1) } } }));
vi.mock("@/lib/social/composio/client", () => ({ deleteConnectedAccount: vi.fn() }));

import { saveCreatorConnection } from "@/lib/creators/connections";

const now = new Date("2026-10-22T10:00:00Z");
const account = { externalAccountId: "17841400000000001", displayName: "@ana.rw", accountType: "creator" };

beforeEach(() => h.upsert.mockClear());

describe("saveCreatorConnection", () => {
  it("saves the follower count and when it was read", async () => {
    await saveCreatorConnection("p1", "instagram", "ca_1", { ...account, followers: 12_300 }, now);
    const call = (h.upsert.mock.calls[0] as unknown as [{ create: Record<string, unknown>; update: Record<string, unknown> }])[0];
    expect(call.create).toMatchObject({ followers: 12_300, followersAt: now });
    expect(call.update).toMatchObject({ followers: 12_300, followersAt: now });
  });

  it("keeps the last count when the network gave none", async () => {
    await saveCreatorConnection("p1", "tiktok", "ca_1", account, now);
    const call = (h.upsert.mock.calls[0] as unknown as [{ update: Record<string, unknown> }])[0];
    expect(call.update).not.toHaveProperty("followers");
    expect(call.update).not.toHaveProperty("followersAt");
  });
});
