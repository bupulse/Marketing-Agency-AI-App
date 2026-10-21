import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The creator marketplace against the real database (the TEST project): a creator's own sign-up through ensureAccount
// (a profile, no company), the listing rule, one-tap applying, answering an invitation, the payment record and a
// report. Skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/creators/marketplace.db.test.ts
// Everything hangs off one throwaway company and one throwaway creator, deleted afterwards. The plan check is mocked
// (the throwaway company has no plan), everything else is real.
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const admin = enabled ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/entitlements", () => ({ hasFeature: vi.fn(async () => true) }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup" }, trackEvent: vi.fn() }));

const DAY = 86_400_000;

describe.skipIf(!enabled)("creator marketplace against the database", { timeout: 120_000 }, () => {
  const ownerId = randomUUID();
  const tag = ownerId.slice(0, 8);
  const creatorEmail = `market-creator-${tag}@example.test`;
  let creatorId = "";
  let prisma: typeof import("@/lib/db").prisma;
  const ids = { business: "", open: "", offer: "", expired: "", profile: "" };
  const now = new Date();

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const { error } = await admin!.auth.admin.createUser({ id: ownerId, email: `market-owner-${tag}@example.test`, email_confirm: true });
    if (error) throw error;
    await prisma.user.create({ data: { id: ownerId, email: `market-owner-${tag}@example.test` } });
    ids.business = (await prisma.business.create({ data: { userId: ownerId, name: `Market test ${tag}`, timezone: "Africa/Kigali" } })).id;
    const campaign = (slug: string, over: Record<string, unknown> = {}) =>
      prisma.creatorCampaign.create({
        data: { businessId: ids.business, slug: `${slug}-${tag}`, name: `Market ${slug}`, brief: "b", status: "LIVE", startsOn: new Date(now.getTime() - 5 * DAY), endsOn: new Date(now.getTime() + 20 * DAY), platforms: ["instagram"], mentions: [], payRules: { ratePerThousand: 1500 }, questions: [{ id: "q1", label: "Why?", required: true }], ...over },
      });
    ids.open = (await campaign("open")).id;
    ids.offer = (await campaign("offer")).id;
    ids.expired = (await campaign("expired")).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.creatorReport.deleteMany({ where: { reporterUserId: creatorId || ownerId } });
    await prisma.creatorCampaign.deleteMany({ where: { businessId: ids.business } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, creatorId].filter(Boolean) } } });
    for (const id of [ownerId, creatorId].filter(Boolean)) await admin!.auth.admin.deleteUser(id).catch(() => null);
    await prisma.$disconnect();
  });

  it("a creator's sign-up gets a User row and a creator profile, and no company", async () => {
    const { data, error } = await admin!.auth.admin.createUser({ email: creatorEmail, email_confirm: true, user_metadata: { account_kind: "creator", full_name: "Market Creator", phone: "0791000000" } });
    if (error || !data.user) throw error;
    creatorId = data.user.id;
    const { ensureAccount } = await import("@/lib/account");
    expect(await ensureAccount(data.user)).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: creatorId }, select: { business: true, membership: true, subscription: true, creator: true } });
    expect(row).toMatchObject({ business: null, membership: null, subscription: null, creator: { name: "Market Creator", phone: "+250791000000" } });
    ids.profile = row.creator!.id;
    const { isCreatorOnly } = await import("@/lib/creators/auth");
    expect(await isCreatorOnly(creatorId)).toBe(true);
  });

  it("lists the company's open campaigns, not the unlisted or hidden ones", async () => {
    const { listedCampaigns } = await import("@/lib/creators/marketplace");
    const mine = async () => (await listedCampaigns(now)).filter((c) => c.company.id === ids.business).map((c) => c.id);
    expect((await mine()).sort()).toEqual([ids.open, ids.offer, ids.expired].sort());
    await prisma.creatorCampaign.update({ where: { id: ids.expired }, data: { listed: false } });
    await prisma.creatorCampaign.update({ where: { id: ids.offer }, data: { hiddenAt: now } });
    expect(await mine()).toEqual([ids.open]);
    const card = (await listedCampaigns(now)).find((c) => c.id === ids.open)!;
    expect(card).toMatchObject({ placesLeft: 20, record: { isNew: true }, company: { name: `Market test ${tag}` } });
    await prisma.creatorCampaign.update({ where: { id: ids.offer }, data: { hiddenAt: null } });
  });

  it("applies in one tap once the profile is complete, once", async () => {
    const { quickApply } = await import("@/lib/creators/quick-apply");
    const { saveProfile } = await import("@/lib/creators/profile");
    const user = { userId: creatorId, email: creatorEmail };
    const form = new Map([["q_q1", "Because"]]);
    expect(await quickApply(user, `open-${tag}`, form)).toMatchObject({ ok: false, incomplete: true });
    await saveProfile(ids.profile, { name: "Market Creator", phone: "+250791000000", location: "Kigali", bio: null, handles: [{ network: "instagram", handle: "market.rw", followers: 5000 }, { network: "tiktok", handle: "mk", followers: 9 }], samples: ["https://www.instagram.com/p/x/"], discoverable: true });
    expect(await quickApply(user, `open-${tag}`, new Map())).toMatchObject({ ok: false, errors: { q_q1: expect.any(String) } });
    expect(await quickApply(user, `open-${tag}`, form)).toEqual({ ok: true });
    const row = await prisma.campaignCreator.findFirstOrThrow({ where: { campaignId: ids.open } });
    expect(row).toMatchObject({ status: "APPLIED", source: "MARKETPLACE", profileId: ids.profile, email: creatorEmail, phone: "+250791000000", handles: [{ network: "instagram", handle: "market.rw", followers: 5000 }], answers: { q1: "Because" } });
    expect(await quickApply(user, `open-${tag}`, form)).toEqual({ ok: false, error: "You already applied to this campaign." });
    // Blocked creators cannot apply.
    await prisma.creatorProfile.update({ where: { id: ids.profile }, data: { blockedAt: now } });
    expect(await quickApply(user, `offer-${tag}`, form)).toMatchObject({ ok: false, error: expect.stringMatching(/cannot apply/) });
    await prisma.creatorProfile.update({ where: { id: ids.profile }, data: { blockedAt: null } });
  });

  it("accepts an invitation (JOINED) and refuses an expired one", async () => {
    const { answerOffer } = await import("@/lib/creators/offer-answers");
    const offered = (campaignId: string, offeredAt: Date) => prisma.campaignCreator.create({ data: { campaignId, profileId: ids.profile, status: "OFFERED", source: "OFFER", offeredAt, offeredBy: ownerId, name: "Market Creator", email: creatorEmail, handles: [] } });
    const fresh = await offered(ids.offer, new Date(now.getTime() - DAY));
    const old = await offered(ids.expired, new Date(now.getTime() - 15 * DAY));
    expect(await answerOffer(ids.profile, fresh.id, "accept", now)).toBe("JOINED");
    expect(await prisma.campaignCreator.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({ status: "JOINED", joinedAt: now });
    await expect(answerOffer(ids.profile, old.id, "accept", now)).rejects.toMatchObject({ code: "expired" });
    // A second tap on the first one.
    await expect(answerOffer(ids.profile, fresh.id, "decline", now)).rejects.toMatchObject({ code: "conflict" });
    const { myCampaignRows } = await import("@/lib/creators/portal");
    const { groupCampaigns } = await import("@/lib/creators/portal-groups");
    const groups = groupCampaigns(await myCampaignRows(ids.profile, creatorEmail), now);
    expect([groups.joined.length, groups.waiting.length, groups.invitations.length]).toEqual([1, 1, 1]);
  });

  it("shows the payment record from paid payouts, and late DUE ones", async () => {
    const { paymentRecord } = await import("@/lib/creators/record");
    const cc = await prisma.campaignCreator.findFirstOrThrow({ where: { campaignId: ids.offer } });
    const p1End = new Date(now.getTime() - 20 * DAY);
    const p1 = await prisma.creatorPeriod.create({ data: { campaignId: ids.offer, index: 1, startsAt: new Date(p1End.getTime() - 30 * DAY), endsAt: p1End, status: "CLOSED" } });
    await prisma.creatorPayout.create({ data: { periodId: p1.id, campaignCreatorId: cc.id, countedViews: 1, amount: 100, breakdown: {}, status: "PAID", paidAt: new Date(p1End.getTime() + 2.5 * DAY), reference: "MM1" } });
    expect(await paymentRecord(ids.business, now)).toEqual({ creatorsPaid: 1, medianDays: 3, late: false, isNew: false });
    const p2 = await prisma.creatorPeriod.create({ data: { campaignId: ids.offer, index: 2, startsAt: p1End, endsAt: new Date(now.getTime() - 15 * DAY), status: "CLOSED" } });
    await prisma.creatorPayout.create({ data: { periodId: p2.id, campaignCreatorId: cc.id, countedViews: 1, amount: 100, breakdown: {}, status: "DUE" } });
    expect((await paymentRecord(ids.business, now)).late).toBe(true);
  });

  it("files one open report per creator and campaign", async () => {
    const { createReport } = await import("@/lib/creators/reports");
    const a = await createReport({ kind: "CAMPAIGN", campaignId: ids.open, reporterUserId: creatorId, reason: "SCAM" });
    const b = await createReport({ kind: "CAMPAIGN", campaignId: ids.open, reporterUserId: creatorId, reason: "OTHER", details: "They asked me to pay first" });
    expect(b.id).toBe(a.id);
    expect(await prisma.creatorReport.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ reason: "OTHER", status: "OPEN", details: "They asked me to pay first" });
  });
});
