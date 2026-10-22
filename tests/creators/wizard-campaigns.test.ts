import { beforeEach, describe, expect, it, vi } from "vitest";

// The wizard's server side (lib/creators/campaigns.ts) against a mocked database: the draft made at step 1 with every
// later step filled, saving one step at a time with the old form's rules, the campaign's Photos folders, and going
// live only when everything is there.

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const prisma = {
    business: { findUnique: fn() },
    campaign: { findFirst: fn() },
    product: { findMany: fn() },
    creatorCampaign: { findFirst: fn(), findUnique: fn(), count: fn(), create: fn(), update: fn(), updateMany: fn() },
    creatorTask: { findMany: fn(), count: fn(), createMany: fn(), update: fn(), updateMany: fn(), deleteMany: fn() },
    creatorPeriod: { findFirst: fn(), deleteMany: fn(), createMany: fn(), updateMany: fn() },
    campaignCreator: { count: fn() },
    mediaAsset: { count: fn(), findFirst: fn() },
    mediaFolder: { findMany: fn(), create: fn() },
    $executeRaw: fn(),
    $transaction: vi.fn(),
  };
  return { prisma, limits: { liveCampaigns: 2, creatorsPerCampaign: 20 } as Record<string, number> };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/plan-catalog", () => ({ getPlanLimits: vi.fn(async () => ({ text: 0, image: 0, videos: 0, voiceCharacters: 0, chat: 0, videoCredits: 0, seats: 1, ...h.limits })) }));
vi.mock("@/lib/auth/request-site", () => ({ linkSiteUrl: async () => "https://bupulse.com" }));
vi.mock("@/lib/publishing/email", () => ({ renderEmail: () => ({ html: "", text: "" }), sendEmail: vi.fn(async () => true) }));
vi.mock("@/lib/region", () => ({ companyRegion: async () => ({ currency: "RWF" }) }));
vi.mock("@/lib/team/service", () => ({ newInviteToken: () => "t", hashToken: async (t: string) => t }));

import { createDraft, emptyOpenSteps, ensureCampaignFolders, saveStep, setCampaignStatus, type CampaignActor } from "@/lib/creators/campaigns";
import { defaultForm } from "@/lib/creators/form-fields";
import { templateSuggestion } from "@/lib/creators/wizard-suggest";

const OWNER: CampaignActor = { actorId: "u1", businessId: "b1", role: "OWNER" };
const MEMBER: CampaignActor = { actorId: "u2", businessId: "b1", role: "MEMBER" };
const NOW = new Date("2026-10-22T08:00:00Z"); // a Thursday

const suggestion = (over: Partial<ReturnType<typeof templateSuggestion>> = {}) => ({
  ...templateSuggestion({ businessName: "LEAF", industry: "Juice bar", country: "Rwanda", contentLanguage: "English", instagramHandle: "leafjuice", currency: "RWF", networks: ["instagram", "facebook"], productNames: ["Mango juice"], creatorsPerCampaign: 20, idea: "Film our new juice", name: "", kind: "CHALLENGE" }),
  ...over,
});
const idea = (over: object = {}) => ({ idea: "Film our new juice", name: "", kind: null, knowledgeCampaignId: null, productIds: [], ...over });

/** A wizard draft as stored. */
const row = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  businessId: "b1",
  name: "Juice week",
  status: "DRAFT",
  setupStep: 5,
  brief: "Show our juice on a hot day.",
  rules: null,
  idea: "Film our juice",
  kind: "CHALLENGE",
  goal: "VIEWS",
  knowledgeCampaignId: null,
  productIds: [],
  requirements: { niches: [], locations: [], languages: [] },
  platforms: ["instagram"],
  platformMode: "ANY",
  formats: ["REEL"],
  mentions: ["@leafjuice"],
  briefEvery: "WEEK",
  dos: ["Tag us"],
  donts: ["No other brands"],
  startsOn: new Date("2026-11-02"),
  endsOn: new Date("2026-12-01"),
  currency: "RWF",
  payRules: { ratePerThousand: 1_500 },
  viewTargetPerCreator: null,
  viewTargetCampaign: null,
  questions: [],
  applicationForm: defaultForm(),
  files: null,
  look: null,
  listed: true,
  acceptingApplications: true,
  ...over,
});
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message: string }) => `${e.code}: ${e.message}`);
const task = (over: Record<string, unknown> = {}) => ({ title: "Start", instructions: "Do the challenge", startsOn: "2026-11-02", endsOn: "2026-11-08", postsPerDay: 1, platforms: ["instagram"], platformMode: "ANY", mediaKind: "VIDEO", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  h.limits = { liveCampaigns: 2, creatorsPerCampaign: 20 };
  h.prisma.$transaction.mockImplementation(async (run: (tx: typeof h.prisma) => unknown) => run(h.prisma));
  h.prisma.business.findUnique.mockResolvedValue({ name: "LEAF", timezone: "Africa/Kigali", userId: "u1", user: { subscription: { plan: "BUSINESS" } } });
  h.prisma.campaign.findFirst.mockResolvedValue(null);
  h.prisma.product.findMany.mockResolvedValue([]);
  h.prisma.creatorCampaign.count.mockResolvedValue(0);
  h.prisma.creatorCampaign.create.mockImplementation(async ({ data }: { data: { slug: string } }) => ({ id: "c1", slug: data.slug }));
  h.prisma.creatorCampaign.findFirst.mockResolvedValue(row());
  h.prisma.creatorCampaign.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.creatorTask.findMany.mockResolvedValue([]);
  h.prisma.creatorTask.count.mockResolvedValue(0);
  h.prisma.creatorPeriod.findFirst.mockResolvedValue(null);
  h.prisma.mediaAsset.count.mockResolvedValue(0);
  h.prisma.mediaFolder.findMany.mockResolvedValue([]);
  h.prisma.mediaFolder.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({ id: `f-${data.name.split("– ")[1]}` }));
});

describe("step 1 makes the draft", () => {
  it("is for owners and admins only", async () => {
    expect(await code(createDraft(MEMBER, idea(), suggestion()))).toBe("forbidden: Ask your company owner or an admin to do this.");
  });

  it("fills every later step from the suggestion, from next Monday", async () => {
    await createDraft(OWNER, idea(), suggestion({ name: "Mango Madness", platforms: ["tiktok", "instagram"] }), { tiktokReady: false });
    const data = h.prisma.creatorCampaign.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "Mango Madness", idea: "Film our new juice", kind: "CHALLENGE", setupStep: 2, goal: "VIEWS", platforms: ["instagram"], formats: ["REEL"], mentions: ["@leafjuice", "#LEAFChallenge"], briefEvery: "WEEK", currency: "RWF", startsOn: new Date("2026-10-26"), endsOn: new Date("2026-11-24") });
    expect(data.brief).toMatch(/LEAF challenge/);
    expect(data.payRules).toEqual({ ratePerThousand: 1_500, rateViews: 1_000, feePerPost: null, milestones: [], capPerPost: null, capPerCreator: null });
    expect(data.requirements).toMatchObject({ niches: ["Food and drinks"], locations: ["Kigali"], creatorsWanted: 5 });
    expect(data.applicationForm.fields.map((f: { id: string }) => f.id)).toEqual(["camera", "adult"]);
    expect(data.tasks.create.map((t: { title: string }) => t.title)).toEqual(["Start the challenge (week 1)", "Challenge a friend (week 2)", "Your best take (week 3)", "The final round (week 4)", "Start the challenge (week 5)"]);
    expect(data.tasks.create[0]).toMatchObject({ startsOn: new Date("2026-10-26"), endsOn: new Date("2026-11-01"), platforms: ["instagram"], mediaKind: "VIDEO" });
    expect(data.periods.create).toHaveLength(1);
  });

  it("keeps the owner's name and takes the dates of the Business info campaign it promotes", async () => {
    h.prisma.campaign.findFirst.mockResolvedValue({ id: "k1", startsAt: new Date("2026-11-20"), endsAt: new Date("2026-11-21") });
    h.prisma.product.findMany.mockResolvedValue([{ id: "p1" }]);
    await createDraft(OWNER, idea({ name: "Open day", knowledgeCampaignId: "k1", productIds: ["p1", "p-other"] }), suggestion());
    expect(h.prisma.creatorCampaign.create.mock.calls[0][0].data).toMatchObject({ name: "Open day", knowledgeCampaignId: "k1", productIds: ["p1"], startsOn: new Date("2026-11-08"), endsOn: new Date("2026-11-21") });
  });
});

describe("saving a step", () => {
  it("moves the draft on to the furthest step reached", async () => {
    await saveStep(OWNER, "c1", "goal", { goal: "SALES" });
    expect(h.prisma.creatorCampaign.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { goal: "SALES", setupStep: 5 } });
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ setupStep: 5 }));
    await saveStep(OWNER, "c1", "rules", { dos: ["Smile"], donts: [], rules: null });
    expect(h.prisma.creatorCampaign.update.mock.calls[1][0].data).toMatchObject({ dos: ["Smile"], setupStep: 8 });
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ setupStep: null, status: "LIVE" }));
    await saveStep(OWNER, "c1", "rules", { dos: ["Smile"], donts: [], rules: null });
    expect(h.prisma.creatorCampaign.update.mock.calls[2][0].data.setupStep).toBeNull();
  });

  it("keeps the pay floor, the plan's creators and an ended campaign as it is", async () => {
    expect(await code(saveStep(OWNER, "c1", "pay", { currency: "RWF", payRules: { ratePerThousand: 900 }, viewTargetPerCreator: null, viewTargetCampaign: null, budget: null }))).toMatch(/^invalid: Pay at least 1,000 RWF for every 1,000 views/);
    h.limits.creatorsPerCampaign = 10;
    expect(await code(saveStep(OWNER, "c1", "creators", { requirements: { niches: [], locations: [], languages: [], creatorsWanted: 11 } }))).toBe("limit: Your plan allows 10 creators in one campaign.");
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ status: "ENDED" }));
    expect(await code(saveStep(OWNER, "c1", "goal", { goal: "SALES" }))).toMatch(/^conflict: This campaign has ended/);
  });

  it("puts the budget on the open periods (only those not started once live)", async () => {
    await saveStep(OWNER, "c1", "pay", { currency: "RWF", payRules: { ratePerThousand: 15_000, rateViews: 10_000 }, viewTargetPerCreator: 50_000, viewTargetCampaign: null, budget: 300_000 }, { now: NOW });
    expect(h.prisma.creatorCampaign.update.mock.calls[0][0].data).toMatchObject({ payRules: { ratePerThousand: 15_000, rateViews: 10_000 }, viewTargetPerCreator: 50_000 });
    expect(h.prisma.creatorPeriod.updateMany).toHaveBeenCalledWith({ where: { campaignId: "c1", status: "OPEN" }, data: { viewTargetPerCreator: 50_000, viewTargetCampaign: null, budget: 300_000 } });
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ status: "LIVE", setupStep: null }));
    expect(await code(saveStep(OWNER, "c1", "pay", { currency: "USD", payRules: { ratePerThousand: 2 }, viewTargetPerCreator: null, viewTargetCampaign: null, budget: null }))).toMatch(/^conflict: The dates and the currency/);
  });

  it("replaces a draft's tasks on Content, inside its dates and networks", async () => {
    await saveStep(OWNER, "c1", "content", { brief: "Dance with our juice.", tasks: [task(), task({ title: "Friend", startsOn: "2026-11-09", endsOn: "2026-11-15" })] });
    expect(h.prisma.creatorTask.deleteMany).toHaveBeenCalledWith({ where: { campaignId: "c1" } });
    expect(h.prisma.creatorTask.createMany.mock.calls[0][0].data.map((t: { title: string }) => t.title)).toEqual(["Start", "Friend"]);
    expect(await code(saveStep(OWNER, "c1", "content", { brief: "x", tasks: [task({ endsOn: "2026-12-30" })] }))).toBe("invalid: The task's days must be inside the campaign's dates.");
    expect(await code(saveStep(OWNER, "c1", "content", { brief: "x", tasks: [task({ platforms: ["tiktok"] })] }))).toBe("invalid: Pick platforms of the campaign only.");
  });

  it("never deletes a live task creators handed in", async () => {
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ status: "LIVE", setupStep: null }));
    h.prisma.creatorTask.findMany.mockResolvedValue([{ id: "t1", title: "Start", _count: { submissions: 2 } }, { id: "t2", title: "Friend", _count: { submissions: 0 } }]);
    expect(await code(saveStep(OWNER, "c1", "content", { brief: "Dance with our juice.", tasks: [task({ id: "t2" })] }))).toBe('conflict: Creators already handed in "Start", so it cannot be deleted. Change its days or words instead.');
    await saveStep(OWNER, "c1", "content", { brief: "Dance with our juice.", tasks: [task({ id: "t1", title: "Start now" }), task({ title: "New one" })] });
    expect(h.prisma.creatorTask.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["t2"] }, campaignId: "c1" } });
    expect(h.prisma.creatorTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.objectContaining({ title: "Start now" }) });
    expect(h.prisma.creatorTask.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ campaignId: "c1", title: "New one" })]);
  });

  it("plans a draft's tasks again when its days change, and remakes its periods", async () => {
    h.prisma.creatorTask.findMany.mockResolvedValue([{ title: "Start (week 1)", instructions: "Do it", startsOn: new Date("2026-11-02"), endsOn: new Date("2026-11-08") }]);
    await saveStep(OWNER, "c1", "when", { startsOn: "2026-11-02", endsOn: "2026-11-15", briefEvery: "WEEK", postsPerDay: 2, mediaKind: "IMAGE" }, { now: NOW });
    expect(h.prisma.creatorPeriod.createMany).toHaveBeenCalled();
    expect(h.prisma.creatorTask.createMany.mock.calls[0][0].data.map((t: { title: string; postsPerDay: number; mediaKind: string }) => [t.title, t.postsPerDay, t.mediaKind])).toEqual([
      ["Start (week 1)", 2, "IMAGE"],
      ["Start (week 2)", 2, "IMAGE"],
    ]);
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ status: "LIVE", setupStep: null }));
    expect(await code(saveStep(OWNER, "c1", "when", { startsOn: "2026-11-02", endsOn: "2026-11-15", briefEvery: "WEEK", postsPerDay: 1, mediaKind: "VIDEO" }))).toMatch(/^conflict: The dates and the currency/);
  });

  it("asks for TikTok only once its app is set up", async () => {
    expect(await code(saveStep(OWNER, "c1", "where", { platforms: ["tiktok"], platformMode: "ANY", formats: [], mentions: [] }))).toMatch(/^invalid: TikTok is coming soon/);
    await saveStep(OWNER, "c1", "where", { platforms: ["tiktok"], platformMode: "ANY", formats: [], mentions: [] }, { tiktokReady: true });
    expect(h.prisma.creatorCampaign.update.mock.calls[0][0].data.platforms).toEqual(["tiktok"]);
  });

  it("fills the steps not reached yet that are empty, asking for a suggestion only then", async () => {
    const suggest = vi.fn(async () => suggestion());
    h.prisma.creatorTask.count.mockResolvedValue(4);
    await saveStep(OWNER, "c1", "idea", idea({ name: "Juice week" }), { suggest });
    expect(suggest).not.toHaveBeenCalled();
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ setupStep: 2, dos: [], donts: [], applicationForm: null }));
    await saveStep(OWNER, "c1", "idea", idea({ name: "Juice week" }), { suggest });
    expect(suggest).toHaveBeenCalledOnce();
    expect(h.prisma.creatorCampaign.update.mock.calls[1][0].data).toMatchObject({ name: "Juice week", dos: suggestion().dos, donts: suggestion().donts, setupStep: 2 });
    expect(emptyOpenSteps(row({ dos: [], donts: [], applicationForm: null }) as never, 1, 8)).toEqual(["form"]);
  });
});

describe("the campaign's files", () => {
  it("makes its three Photos folders once, with names of their own", async () => {
    h.prisma.creatorCampaign.findUnique.mockResolvedValue({ files: null });
    h.prisma.mediaFolder.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: "Juice week – Images" }]);
    const files = await ensureCampaignFolders(OWNER, "c1");
    expect(h.prisma.mediaFolder.create.mock.calls.map((c) => c[0].data.name)).toEqual(["Juice week – Images (2)", "Juice week – Videos", "Juice week – Documents"]);
    expect(files).toMatchObject({ imagesFolderId: "f-Images (2)", videosFolderId: "f-Videos", documentsFolderId: "f-Documents" });
    expect(h.prisma.creatorCampaign.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { files: expect.objectContaining({ imagesFolderId: "f-Images (2)" }) } });

    vi.clearAllMocks();
    h.prisma.$transaction.mockImplementation(async (run: (tx: typeof h.prisma) => unknown) => run(h.prisma));
    h.prisma.creatorCampaign.findUnique.mockResolvedValue({ files: { imagesFolderId: "a", videosFolderId: "b", documentsFolderId: "c", exampleLinks: [] } });
    h.prisma.mediaFolder.findMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }, { id: "c" }]);
    await ensureCampaignFolders(OWNER, "c1");
    expect(h.prisma.mediaFolder.create).not.toHaveBeenCalled();
  });
});

describe("going live", () => {
  it("needs everything for a wizard campaign, and leaves the wizard", async () => {
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ files: { imagesFolderId: "a", videosFolderId: "b", exampleLinks: [] } }));
    h.prisma.creatorTask.count.mockResolvedValue(5);
    expect(await code(setCampaignStatus(OWNER, "c1", "LIVE", NOW))).toBe("invalid: Add your logo and product photos to the Images folder (step Files). Add an example video or a link to a post you like (step Files).");
    h.prisma.mediaAsset.count.mockResolvedValue(2);
    await setCampaignStatus(OWNER, "c1", "LIVE", NOW);
    expect(h.prisma.creatorCampaign.updateMany).toHaveBeenCalledWith({ where: { id: "c1", status: "DRAFT" }, data: { status: "LIVE", setupStep: null } });
  });

  it("keeps the old rule for campaigns made before the wizard", async () => {
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ setupStep: null, applicationForm: null }));
    h.prisma.creatorTask.count.mockResolvedValue(1);
    await setCampaignStatus(OWNER, "c1", "LIVE", NOW);
    expect(h.prisma.creatorCampaign.updateMany).toHaveBeenCalled();
    expect(h.prisma.mediaAsset.count).not.toHaveBeenCalled();
  });
});
