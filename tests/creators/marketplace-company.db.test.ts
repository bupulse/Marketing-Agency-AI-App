import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The company side of the creator marketplace against the real database (the TEST project): the finder's SQL filters
// and its campaign record across companies, offers (one open per creator and campaign, the plan's places, withdraw),
// picking an applicant who has an account (JOINED at once), and an admin block withdrawing open offers with its audit
// row. Skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/creators/marketplace-company.db.test.ts
// Everything hangs off throwaway users and companies, deleted afterwards (AuditLog rows stay: the table is append-only).
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const admin = enabled ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const h = vi.hoisted(() => ({ sendEmail: vi.fn(async () => true), places: 2 }));
vi.mock("@/lib/publishing/email", async () => ({ ...(await vi.importActual<typeof import("@/lib/publishing/email")>("@/lib/publishing/email")), sendEmail: h.sendEmail }));
vi.mock("@/lib/auth/request-site", () => ({ linkSiteUrl: async () => "https://bupulse.test" }));
vi.mock("@/lib/plan-catalog", async () => {
  const real = await vi.importActual<typeof import("@/lib/plan-catalog")>("@/lib/plan-catalog");
  return { ...real, getPlanLimits: async (plan: string) => ({ ...(await real.getPlanLimits(plan)), creatorsPerCampaign: h.places }) };
});
vi.mock("@/lib/errors", async () => ({ ...(await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors")), logError: vi.fn() }));

describe.skipIf(!enabled)("creator marketplace, company side, against the database", { timeout: 120_000 }, () => {
  const tag = randomUUID().slice(0, 8);
  const users = { owner: randomUUID(), other: randomUUID(), aline: randomUUID(), bea: randomUUID(), cleo: randomUUID(), dan: randomUUID() };
  const email = (who: string) => `mk-${who}-${tag}@example.test`;
  const ids = { business: "", otherBusiness: "", campaign: "", draft: "", aline: "", bea: "", cleo: "", dan: "" };
  // Every profile's location carries the tag, so the finder only ever sees this test's creators.
  const town = `Zz${tag}`;
  let prisma: typeof import("@/lib/db").prisma;
  let actor: import("@/lib/creators/campaigns").CampaignActor;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    for (const [who, id] of Object.entries(users)) {
      const { error } = await admin!.auth.admin.createUser({ id, email: email(who), email_confirm: true });
      if (error) throw error;
      await prisma.user.create({ data: { id, email: email(who) } });
    }
    ids.business = (await prisma.business.create({ data: { userId: users.owner, name: `Marketplace test ${tag}`, timezone: "UTC" } })).id;
    ids.otherBusiness = (await prisma.business.create({ data: { userId: users.other, name: `Other company ${tag}`, timezone: "UTC" } })).id;
    actor = { actorId: users.owner, businessId: ids.business, role: "OWNER" };
    const campaign = (businessId: string, name: string, status: string) =>
      prisma.creatorCampaign.create({ data: { businessId, slug: `mk-${name}-${tag}`, name, brief: "b", status, startsOn: new Date("2026-11-01"), endsOn: new Date("2026-11-30"), platforms: ["instagram", "tiktok"], mentions: [], payRules: { ratePerThousand: 1000 } }, select: { id: true } });
    ids.campaign = (await campaign(ids.business, "Summer", "LIVE")).id;
    ids.draft = (await campaign(ids.business, "Winter", "DRAFT")).id;
    const profile = (who: keyof typeof users, data: Record<string, unknown>) => prisma.creatorProfile.create({ data: { userId: users[who], name: who, samples: [], ...data }, select: { id: true } });
    ids.aline = (await profile("aline", { discoverable: true, location: `${town} Kigali`, phone: "+250780000001", handles: [{ network: "instagram", handle: "@aline", followers: 12_000 }, { network: "tiktok", handle: "@aline", followers: 3_000 }] })).id;
    ids.bea = (await profile("bea", { discoverable: true, location: `${town} Musanze`, handles: [{ network: "tiktok", handle: "@bea", followers: 60_000 }] })).id;
    ids.cleo = (await profile("cleo", { discoverable: false, location: `${town} Kigali`, handles: [{ network: "instagram", handle: "@cleo", followers: 90_000 }] })).id;
    ids.dan = (await profile("dan", { discoverable: true, blockedAt: new Date(), blockedReason: "test", location: `${town} Kigali`, handles: [{ network: "instagram", handle: "@dan", followers: 5_000 }] })).id;
    await prisma.creatorConnection.create({ data: { profileId: ids.aline, network: "instagram", composioConnectedAccountId: "ca_test", externalAccountId: `ig-${tag}`, username: "aline", status: "ACTIVE" } });

    // Aline's record in another company's campaign: joined, ended, 2 posts that counted (7,000 views) and one rejected.
    const theirs = await prisma.creatorCampaign.create({ data: { businessId: ids.otherBusiness, slug: `mk-other-${tag}`, name: "Secret pay campaign", brief: "b", status: "ENDED", startsOn: new Date("2026-09-01"), endsOn: new Date("2026-09-30"), platforms: ["instagram"], mentions: [], payRules: { ratePerThousand: 99_999 } } });
    const task = await prisma.creatorTask.create({ data: { campaignId: theirs.id, title: "t", instructions: "i", startsOn: new Date("2026-09-01"), endsOn: new Date("2026-09-30"), platforms: ["instagram"] } });
    const cc = await prisma.campaignCreator.create({ data: { campaignId: theirs.id, profileId: ids.aline, status: "JOINED", joinedAt: new Date("2026-09-01"), name: "aline", email: email("aline"), handles: [] } });
    const sub = await prisma.creatorSubmission.create({ data: { campaignId: theirs.id, taskId: task.id, campaignCreatorId: cc.id, day: new Date("2026-09-02"), title: "t", caption: "c" } });
    for (const [n, status, views] of [[1, "FINAL", 5000], [2, "FINAL", 2000], [3, "REJECTED", 800]] as const) {
      await prisma.creatorPost.create({ data: { submissionId: sub.id, campaignId: theirs.id, campaignCreatorId: cc.id, network: "instagram", url: `https://www.instagram.com/p/MK${tag}${n}/`, externalId: `mk-${tag}-${n}`, status, views } });
    }
   }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.creatorReport.deleteMany({ where: { profileId: { in: [ids.aline, ids.bea, ids.cleo, ids.dan].filter(Boolean) } } });
    await prisma.creatorCampaign.deleteMany({ where: { businessId: { in: [ids.business, ids.otherBusiness].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    for (const id of Object.values(users)) await admin!.auth.admin.deleteUser(id).catch(() => null);
    await prisma.$disconnect();
  }, 120_000);

  const find = async (q: Record<string, string>) => {
    const { findCreators, readFinderFilters } = await import("@/lib/creators/finder");
    return (await findCreators(actor, readFinderFilters({ location: town, ...q }))).creators;
  };

  it("finds only creators who chose to be found and are not blocked, most followers first", async () => {
    expect((await find({})).map((c) => c.name)).toEqual(["bea", "aline"]);
  });

  it("filters by platform, followers on that platform, location and verified", async () => {
    expect((await find({ platform: "instagram" })).map((c) => c.name)).toEqual(["aline"]);
    expect((await find({ platform: "tiktok", min: "5000" })).map((c) => c.name)).toEqual(["bea"]);
    expect((await find({ platform: "tiktok", max: "5000" })).map((c) => c.name)).toEqual(["aline"]);
    expect((await find({ min: "10000", max: "50000" })).map((c) => c.name)).toEqual(["aline"]);
    expect((await find({ location: `${town} musanze` })).map((c) => c.name)).toEqual(["bea"]);
    expect(await find({ location: `${town}%` })).toEqual([]);
    expect((await find({ verified: "1" })).map((c) => c.name)).toEqual(["aline"]);
    expect(await find({ verified: "1", platform: "tiktok" })).toEqual([]);
  });

  it("shows the record across companies without their names or pay, and no contact details before they apply", async () => {
    const [aline] = await find({ platform: "instagram" });
    expect(aline.record).toEqual({ joined: 1, ended: 1, countedPosts: 2, views: 7000, removedPosts: 1 });
    expect(aline.handles.find((x) => x.network === "instagram")?.verified).toBe(true);
    expect(aline.contact).toBeNull();
    expect(JSON.stringify(aline)).not.toMatch(/Secret pay|Other company|99999/);
  });

  it("invites: one open offer per campaign, holding a place; contact details stay hidden until they join", async () => {
    const { offerCreator, withdrawOffer } = await import("@/lib/creators/offers");
    const { listCampaignCreators } = await import("@/lib/creators/campaigns");
    const offer = await offerCreator(actor, { profileId: ids.aline, campaignId: ids.campaign });
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: email("aline") }));
    const row = await prisma.campaignCreator.findUniqueOrThrow({ where: { id: offer.id } });
    expect(row).toMatchObject({ status: "OFFERED", source: "OFFER", offeredBy: users.owner, profileId: ids.aline, email: email("aline"), phone: "+250780000001" });
    await expect(offerCreator(actor, { profileId: ids.aline, campaignId: ids.campaign })).rejects.toMatchObject({ code: "conflict" });
    await expect(offerCreator(actor, { profileId: ids.cleo, campaignId: ids.campaign })).rejects.toMatchObject({ code: "not_found" });
    await expect(offerCreator(actor, { profileId: ids.dan, campaignId: ids.campaign })).rejects.toMatchObject({ code: "conflict" });
    const listed = (await listCampaignCreators(actor, ids.campaign)).find((r) => r.id === offer.id);
    expect(listed).toMatchObject({ status: "OFFERED", email: null, phone: null });

    // Two places on the plan: Aline's offer and Bea's take them both.
    await offerCreator(actor, { profileId: ids.bea, campaignId: ids.campaign });
    h.places = 2;
    const extra = await prisma.campaignCreator.create({ data: { campaignId: ids.campaign, status: "APPLIED", name: "Late", email: `late-${tag}@example.test`, handles: [] } });
    const { selectApplicant } = await import("@/lib/creators/campaigns");
    await expect(selectApplicant(actor, extra.id)).rejects.toMatchObject({ code: "limit" });

    // An expired offer frees its place, and can be made again on the same row.
    await prisma.campaignCreator.update({ where: { id: offer.id }, data: { offeredAt: new Date(Date.now() - 15 * 864e5) } });
    const again = await offerCreator(actor, { profileId: ids.aline, campaignId: ids.campaign });
    expect(again.id).toBe(offer.id);
    await withdrawOffer(actor, offer.id);
    expect((await prisma.campaignCreator.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("DECLINED");
    await prisma.campaignCreator.delete({ where: { id: extra.id } });
  });

  it("adds an applicant who has an account at once (JOINED, no link), and then shows their contact details", async () => {
    const { selectApplicant } = await import("@/lib/creators/campaigns");
    h.places = 5;
    const applied = await prisma.campaignCreator.create({ data: { campaignId: ids.draft, profileId: ids.aline, source: "MARKETPLACE", status: "APPLIED", name: "aline", email: email("aline"), phone: "+250780000001", handles: [] } });
    const picked = await selectApplicant(actor, applied.id);
    expect(picked).toMatchObject({ joined: true });
    const row = await prisma.campaignCreator.findUniqueOrThrow({ where: { id: applied.id } });
    expect(row).toMatchObject({ status: "JOINED", inviteTokenHash: null });
    expect(row.joinedAt).toBeInstanceOf(Date);
    const [aline] = await find({ platform: "instagram" });
    expect(aline.contact).toEqual({ phone: "+250780000001", email: email("aline") });
  });

  it("an admin block withdraws open offers, hides the creator from the finder, and is audited", async () => {
    const { blockCreator, unblockCreator } = await import("@/lib/admin/creators-marketplace");
    const { consoleContext } = await import("@/lib/admin/types");
    const bea = await prisma.campaignCreator.findFirstOrThrow({ where: { campaignId: ids.campaign, profileId: ids.bea } });
    expect(bea.status).toBe("OFFERED");
    const r = await blockCreator(consoleContext("203.0.113.9"), { profileId: ids.bea, reason: "db test block" });
    expect(r.offersWithdrawn).toBe(1);
    expect((await prisma.campaignCreator.findUniqueOrThrow({ where: { id: bea.id } })).status).toBe("DECLINED");
    expect((await find({})).map((c) => c.name)).toEqual(["aline"]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "creators_block_creator", target: `creator_profile:${ids.bea}` } });
    expect(audit?.after).toMatchObject({ reason: "db test block", offersWithdrawn: 1 });
    await unblockCreator(consoleContext("203.0.113.9"), { profileId: ids.bea });
    expect((await find({})).map((c) => c.name)).toEqual(["bea", "aline"]);
  });

  it("a company report lands as an OPEN creator report, and resolves once", async () => {
    const { reportCreator } = await import("@/lib/creators/finder");
    const { resolveReport } = await import("@/lib/admin/creators-marketplace");
    const { consoleContext } = await import("@/lib/admin/types");
    const { id } = await reportCreator(actor, { profileId: ids.bea, reason: "FAKE_VIEWS", details: "db test" });
    expect(await prisma.creatorReport.findUniqueOrThrow({ where: { id } })).toMatchObject({ kind: "CREATOR", status: "OPEN", businessId: ids.business, reporterUserId: users.owner });
    await resolveReport(consoleContext("203.0.113.9"), { reportId: id, note: "db test resolved" });
    expect(await prisma.creatorReport.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "RESOLVED", resolution: "db test resolved" });
    await expect(resolveReport(consoleContext("203.0.113.9"), { reportId: id, note: "again" })).rejects.toMatchObject({ code: "conflict" });
  });
});
