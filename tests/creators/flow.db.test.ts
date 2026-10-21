import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The creator views job against the real database (the TEST project), with a fake network: the final reading at a
// period's end, the close and its payouts (twice at once: one close), a post that disappears (two misses, then
// REMOVED, its DUE pay dropped), an account disconnected for over 3 days, and pay taken back from the next payout.
// Skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/creators/flow.db.test.ts
// Everything it makes hangs off one throwaway company and is deleted afterwards; the job only looks at its campaign.
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const admin = enabled ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import type { CreatorAdapter, NetworkPost } from "@/lib/creators/tracking/types";

const DAY = 86_400_000;

describe.skipIf(!enabled)("creator views job against the database", { timeout: 120_000 }, () => {
  const ownerId = randomUUID();
  const creatorUserId = randomUUID();
  const tag = ownerId.slice(0, 8);
  let prisma: typeof import("@/lib/db").prisma;
  let runCreatorViews: typeof import("@/lib/creators/tracking/job").runCreatorViews;
  let closePeriod: typeof import("@/lib/creators/tracking/close").closePeriod;
  const ids = { business: "", campaign: "", p1: "", p2: "", cc: "", conn: "", post1: "", post2: "", post3: "" };

  // The network: views per external id; ids in `gone` are not on the account any more.
  const views = new Map<string, number>();
  const gone = new Set<string>();
  const reads: string[][] = [];
  const network: CreatorAdapter = {
    accounts: async () => [],
    find: async () => null,
    read: async (_call, _account, posts) => {
      reads.push(posts.map((p) => p.externalId));
      const found = new Map<string, NetworkPost>();
      for (const p of posts) if (!gone.has(p.externalId)) found.set(p.externalId, { externalId: p.externalId, permalink: null, postedAt: p.postedAt, caption: null, views: views.get(p.externalId) ?? 0, reach: null, likes: 1, comments: 0, shares: 0 });
      return { found, gone: posts.map((p) => p.externalId).filter((id) => gone.has(id)) };
    },
  };
  const deps = { adapter: () => network, caller: () => ({ tool: vi.fn(), proxy: vi.fn() }), ready: async () => true, limit: async () => 1_000_000, notify: false };
  const run = (now: Date) => runCreatorViews({ now, budgetMs: 60_000, only: [ids.campaign] }, deps);

  // Period 1: 1-30 September; period 2: 1-30 October (UTC, so the arithmetic is plain).
  const P1_END = new Date("2026-10-01T00:00:00Z");
  const P2_END = new Date("2026-10-31T00:00:00Z");

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ runCreatorViews } = await import("@/lib/creators/tracking/job"));
    ({ closePeriod } = await import("@/lib/creators/tracking/close"));
    for (const [id, who] of [[ownerId, "owner"], [creatorUserId, "creator"]]) {
      const { error } = await admin!.auth.admin.createUser({ id, email: `creators-${who}-${tag}@example.test`, email_confirm: true });
      if (error) throw error;
      await prisma.user.create({ data: { id, email: `creators-${who}-${tag}@example.test` } });
    }
    const business = await prisma.business.create({ data: { userId: ownerId, name: `Creators test ${tag}`, timezone: "UTC" } });
    ids.business = business.id;
    const profile = await prisma.creatorProfile.create({ data: { userId: creatorUserId, name: "Test Creator" } });
    const campaign = await prisma.creatorCampaign.create({
      data: { businessId: business.id, slug: `test-${tag}`, name: "Test campaign", brief: "b", status: "LIVE", startsOn: new Date("2026-09-01"), endsOn: new Date("2026-10-30"), platforms: ["instagram"], mentions: [], payRules: { ratePerThousand: 1000 } },
    });
    ids.campaign = campaign.id;
    ids.p1 = (await prisma.creatorPeriod.create({ data: { campaignId: campaign.id, index: 1, startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: P1_END } })).id;
    ids.p2 = (await prisma.creatorPeriod.create({ data: { campaignId: campaign.id, index: 2, startsAt: P1_END, endsAt: P2_END } })).id;
    const task = await prisma.creatorTask.create({ data: { campaignId: campaign.id, title: "t", instructions: "i", startsOn: new Date("2026-09-01"), endsOn: new Date("2026-10-30"), platforms: ["instagram"] } });
    const cc = await prisma.campaignCreator.create({ data: { campaignId: campaign.id, profileId: profile.id, status: "JOINED", name: "Test Creator", email: `creators-creator-${tag}@example.test`, handles: [] } });
    ids.cc = cc.id;
    ids.conn = (await prisma.creatorConnection.create({ data: { profileId: profile.id, network: "instagram", composioConnectedAccountId: "ca_test", externalAccountId: `ig-${tag}`, status: "ACTIVE", lastCheckedAt: new Date("2026-09-20T00:00:00Z") } })).id;
    // Handed in on the day it was posted (the ledger counts posts made before a period's end).
    const sub = await prisma.creatorSubmission.create({ data: { campaignId: campaign.id, taskId: task.id, campaignCreatorId: cc.id, day: new Date("2026-09-20"), title: "t", caption: "c" } });
    const post = (n: number, postedAt: Date) =>
      prisma.creatorPost.create({ data: { submissionId: sub.id, campaignId: campaign.id, campaignCreatorId: cc.id, connectionId: ids.conn, network: "instagram", url: `https://www.instagram.com/p/T${tag}${n}/`, externalId: `m-${tag}-${n}`, postedAt, status: "TRACKING", lastReadAt: postedAt, nextReadAt: postedAt, createdAt: postedAt } });
    ids.post1 = (await post(1, new Date("2026-09-20T10:00:00Z"))).id;
    ids.post2 = (await post(2, new Date("2026-09-25T10:00:00Z"))).id;
    ids.post3 = (await post(3, new Date("2026-09-26T10:00:00Z"))).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.creatorCampaign.deleteMany({ where: { businessId: ids.business } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, creatorUserId] } } });
    for (const id of [ownerId, creatorUserId]) await admin!.auth.admin.deleteUser(id).catch(() => null);
    await prisma.$disconnect();
  });

  const extId = (n: number) => `m-${tag}-${n}`;

  it("takes the final reading of period 1 at its end, closes it and writes the payout, once", async () => {
    views.set(extId(1), 5000).set(extId(2), 1000).set(extId(3), 2000);
    const now = new Date(P1_END.getTime() + 3 * 3600_000);
    const r = await run(now);
    expect(r).toMatchObject({ closed: 1, snapshots: 3 });
    const snap = await prisma.creatorPostSnapshot.findFirst({ where: { postId: ids.post1 } });
    expect(snap?.capturedAt.toISOString()).toBe(P1_END.toISOString());
    const payouts = await prisma.creatorPayout.findMany({ where: { periodId: ids.p1 } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ campaignCreatorId: ids.cc, amount: 8000, countedViews: 8000, status: "DUE" });
    // A second run: nothing more.
    expect(await run(new Date(now.getTime() + 60_000))).toMatchObject({ closed: 0 });
    expect(await prisma.creatorPayout.count({ where: { periodId: ids.p1 } })).toBe(1);
  });

  it("reads due posts in one batch per account and writes a snapshot only when the numbers changed", async () => {
    reads.length = 0;
    views.set(extId(1), 5000).set(extId(2), 1500).set(extId(3), 2000);
    await prisma.creatorPost.updateMany({ where: { campaignId: ids.campaign }, data: { nextReadAt: null } });
    const r = await run(new Date("2026-10-05T00:00:00Z"));
    expect(reads).toHaveLength(1);
    expect(reads[0].sort()).toEqual([extId(1), extId(2), extId(3)]);
    expect(r).toMatchObject({ read: 3, snapshots: 1 });
    expect(await prisma.creatorPostSnapshot.count({ where: { postId: ids.post2 } })).toBe(2);
  });

  it("removes a post only after two misses 6 hours apart, and takes its pay out of the DUE payout", async () => {
    gone.add(extId(2));
    await prisma.creatorPost.updateMany({ where: { campaignId: ids.campaign }, data: { nextReadAt: null } });
    await run(new Date("2026-10-06T00:00:00Z"));
    expect((await prisma.creatorPost.findUnique({ where: { id: ids.post2 } }))?.status).toBe("TRACKING");
    await prisma.creatorPost.updateMany({ where: { campaignId: ids.campaign }, data: { nextReadAt: null } });
    const r = await run(new Date("2026-10-06T07:00:00Z"));
    expect(r.removed).toBe(1);
    const removed = await prisma.creatorPost.findUnique({ where: { id: ids.post2 } });
    expect(removed).toMatchObject({ status: "REMOVED", statusReason: expect.stringMatching(/no longer on your Instagram/) });
    const payout = await prisma.creatorPayout.findFirstOrThrow({ where: { periodId: ids.p1 } });
    expect(payout).toMatchObject({ amount: 7000, countedViews: 7000 });
  });

  it("removes the posts of an account disconnected for over 3 days", async () => {
    await prisma.creatorPayout.updateMany({ where: { periodId: ids.p1 }, data: { status: "PAID", paidAt: new Date(), reference: "MOMO123" } });
    await prisma.creatorConnection.update({ where: { id: ids.conn }, data: { status: "EXPIRED", lastCheckedAt: new Date("2026-10-06T07:00:00Z") } });
    expect((await run(new Date("2026-10-08T00:00:00Z"))).removed).toBe(0);
    const r = await run(new Date("2026-10-09T08:00:00Z"));
    expect(r.removed).toBe(2);
    expect(await prisma.creatorPost.count({ where: { campaignId: ids.campaign, status: "REMOVED" } })).toBe(3);
  });

  it("closes the last period once even when two closes race, takes back paid pay, and ends the campaign", async () => {
    const now = new Date(P2_END.getTime() + 25 * 3600_000);
    const results = await Promise.all([closePeriod(ids.p2, now), closePeriod(ids.p2, now)]);
    expect(results.map((x) => x.status).sort()).toEqual(["already", "closed"]);
    const payout = await prisma.creatorPayout.findFirstOrThrow({ where: { periodId: ids.p2 } });
    // Nothing earned in October (every post was removed); the 7,000 paid for posts 1 and 3 is still owed.
    expect(payout).toMatchObject({ amount: 0 });
    expect((payout.breakdown as { stillOwed: number; deducted: { postId: string }[] }).stillOwed).toBe(7000);
    expect((await prisma.creatorCampaign.findUniqueOrThrow({ where: { id: ids.campaign } })).status).toBe("ENDED");
  });
});
