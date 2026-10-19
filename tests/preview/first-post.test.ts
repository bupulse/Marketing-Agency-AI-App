import { beforeEach, describe, expect, it, vi } from "vitest";

// The free first-post preview (lib/preview/first-post.ts): the switch, the waiting-for-demo-only exception in
// lib/usage.ts and lib/entitlements.ts, one per company, one retry, the cost estimate. No database, no AI.

const db = vi.hoisted(() => ({
  firstPostPreview: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  business: { findUnique: vi.fn() },
  subscription: { findUnique: vi.fn() },
  usageRecord: { createMany: vi.fn(), updateMany: vi.fn() },
  aiCall: { aggregate: vi.fn() },
  errorLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
const settings = vi.hoisted(() => ({ getSetting: vi.fn() }));
vi.mock("@/lib/admin/settings", () => settings);
const ai = vi.hoisted(() => ({ generate: vi.fn(), ledger: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "fake" }) }));
vi.mock("@/lib/ai/marketing", () => ({ generateMarketingContent: ai.generate }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: ai.ledger }));

import { previewAllowed } from "@/lib/entitlements";
import { FIRST_POST_FEATURE, getFirstPostPreview, makeFirstPostPreview, previewCostUsd, previewOffered, PREVIEW_TOKENS } from "@/lib/preview/first-post";
import { assertPreviewAllowed, consumeUsage, UsageLimitError } from "@/lib/usage";

const IDS = { userId: "00000000-0000-4000-8000-000000000001", businessId: "b1" };
const sub = (status: string, suspended = false) => ({ status, plan: "TRIAL", user: { suspendedAt: suspended ? new Date() : null } });
/** The company's subscription status as companyMayPreview reads it (through the business). */
let currentStatus = "PENDING_DEMO";
const content = { caption: "Fresh kitenge dresses in Kigali.", hashtags: ["#Kigali", "#Kitenge"], videoScript: "0-5s", adHeadlines: ["Kitenge for every day", "b", "c"] };

beforeEach(() => {
  vi.clearAllMocks();
  settings.getSetting.mockResolvedValue(true);
  db.subscription.findUnique.mockResolvedValue(sub("PENDING_DEMO"));
  // companyMayPreview reads the company's subscription through the business.
  db.business.findUnique.mockImplementation((args: { select?: unknown; include?: unknown }) =>
    Promise.resolve(args.select ? { user: { subscription: { plan: "TRIAL", status: currentStatus, chosenPlan: "BUSINESS", trialEndsAt: null, provider: null, cancelAtPeriodEnd: false, currentPeriodEnd: null } } } : { id: "b1", name: "Inzu Fashion", industry: "Shops", industryRef: null, description: "Kitenge dresses", industryDescription: null, audience: "Young women", tone: "friendly", website: null, contentLanguage: "English", knowledge: {} }),
  );
  currentStatus = "PENDING_DEMO";
  db.firstPostPreview.findUnique.mockResolvedValue(null);
  db.firstPostPreview.create.mockResolvedValue({});
  db.firstPostPreview.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ status: "making", caption: null, hashtags: [], headline: null, attempts: 1, ...data }));
  db.errorLog.create.mockResolvedValue({});
  ai.ledger.mockImplementation((_ctx: unknown, _meta: unknown, call: () => unknown) => call());
  ai.generate.mockResolvedValue({ content, provider: "gemini", model: "gemini-3.8-flash", usage: { inputTokens: 2000, outputTokens: 700 } });
});

describe("the exception is only for companies waiting for their demo", () => {
  it("entitlements: previewAllowed only while PENDING_DEMO", () => {
    expect(previewAllowed({ status: "PENDING_DEMO" })).toBe(true);
    for (const status of ["TRIALING", "ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED"]) expect(previewAllowed({ status })).toBe(false);
    expect(previewAllowed(null)).toBe(false);
  });

  it("usage: assertPreviewAllowed passes a waiting, unsuspended company and refuses everyone else", async () => {
    await expect(assertPreviewAllowed(IDS.userId)).resolves.toBeUndefined();
    db.subscription.findUnique.mockResolvedValueOnce(sub("PENDING_DEMO", true));
    await expect(assertPreviewAllowed(IDS.userId)).rejects.toBeInstanceOf(UsageLimitError);
    db.subscription.findUnique.mockResolvedValueOnce(sub("TRIALING"));
    await expect(assertPreviewAllowed(IDS.userId)).rejects.toBeInstanceOf(UsageLimitError);
  });

  it("usage: everything else stays refused while waiting for the demo, and the preview counts nothing", async () => {
    await expect(consumeUsage(IDS.userId, "text")).rejects.toMatchObject({ reason: "pending_demo" });
    await assertPreviewAllowed(IDS.userId);
    expect(db.usageRecord.createMany).not.toHaveBeenCalled();
    expect(db.usageRecord.updateMany).not.toHaveBeenCalled();
  });
});

describe("making the preview", () => {
  it("does nothing and spends nothing while the Admin switch is off", async () => {
    settings.getSetting.mockResolvedValue(false);
    await expect(makeFirstPostPreview(IDS)).rejects.toMatchObject({ code: "off" });
    expect(await previewOffered("b1")).toBe(false);
    expect(ai.ledger).not.toHaveBeenCalled();
    expect(db.firstPostPreview.create).not.toHaveBeenCalled();
  });

  it("refuses a company whose trial has started (the whole app is open then)", async () => {
    currentStatus = "TRIALING";
    await expect(makeFirstPostPreview(IDS)).rejects.toMatchObject({ code: "not_waiting" });
    expect(ai.ledger).not.toHaveBeenCalled();
  });

  it("claims the company's one row, calls the AI once through the ledger and saves the post", async () => {
    const v = await makeFirstPostPreview(IDS);
    expect(v).toEqual({ status: "ready", caption: content.caption, hashtags: content.hashtags, headline: "Kitenge for every day", canRetry: false });
    expect(db.firstPostPreview.create).toHaveBeenCalledWith({ data: { businessId: "b1", userId: IDS.userId, status: "making", attempts: 1, hashtags: [] } });
    expect(ai.ledger).toHaveBeenCalledTimes(1);
    expect(ai.ledger.mock.calls[0][0]).toEqual({ userId: IDS.userId, businessId: "b1", feature: FIRST_POST_FEATURE });
    expect(ai.generate.mock.calls[0][1]).toMatchObject({ businessName: "Inzu Fashion", description: "Kitenge dresses" });
  });

  it("returns the existing post without a second AI call", async () => {
    db.firstPostPreview.findUnique.mockResolvedValue({ status: "ready", caption: "Hi", hashtags: [], headline: null, attempts: 1 });
    expect((await makeFirstPostPreview(IDS)).caption).toBe("Hi");
    expect(ai.ledger).not.toHaveBeenCalled();
    expect(db.firstPostPreview.create).not.toHaveBeenCalled();
  });

  it("two clicks at once make one call: the second finds the first one's row", async () => {
    db.firstPostPreview.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "making", caption: null, hashtags: [], headline: null, attempts: 1 });
    db.firstPostPreview.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    expect((await makeFirstPostPreview(IDS)).status).toBe("making");
    expect(ai.ledger).not.toHaveBeenCalled();
  });

  it("a failed call is saved as failed, may be tried once more, then not again", async () => {
    ai.generate.mockRejectedValueOnce(new Error("AI down"));
    await expect(makeFirstPostPreview(IDS)).rejects.toMatchObject({ code: "failed" });
    expect(db.firstPostPreview.update).toHaveBeenLastCalledWith({ where: { businessId: "b1" }, data: { status: "failed", error: "AI down" } });

    db.firstPostPreview.findUnique.mockResolvedValue({ status: "failed", caption: null, hashtags: [], headline: null, attempts: 1 });
    db.firstPostPreview.updateMany.mockResolvedValue({ count: 1 });
    expect((await makeFirstPostPreview(IDS)).status).toBe("ready");
    expect(db.firstPostPreview.updateMany).toHaveBeenCalledWith({ where: { businessId: "b1", status: "failed", attempts: 1 }, data: { status: "making", attempts: 2, error: null } });

    vi.clearAllMocks();
    settings.getSetting.mockResolvedValue(true);
    db.subscription.findUnique.mockResolvedValue(sub("PENDING_DEMO"));
    db.firstPostPreview.findUnique.mockResolvedValue({ status: "failed", caption: null, hashtags: [], headline: null, attempts: 2 });
    await expect(makeFirstPostPreview(IDS)).rejects.toMatchObject({ code: "used" });
    expect(ai.ledger).not.toHaveBeenCalled();
  });

  it("shows a failed preview's retry only while one is left", async () => {
    db.firstPostPreview.findUnique.mockResolvedValueOnce({ status: "failed", caption: null, hashtags: [], headline: null, attempts: 1 });
    expect((await getFirstPostPreview("b1"))?.canRetry).toBe(true);
    db.firstPostPreview.findUnique.mockResolvedValueOnce({ status: "failed", caption: null, hashtags: [], headline: null, attempts: 2 });
    expect((await getFirstPostPreview("b1"))?.canRetry).toBe(false);
  });
});

describe("cost per sign-up (lib/ai/pricing.ts)", () => {
  it("is about half a cent on the default Gemini model, more on Claude, null for an unknown model", () => {
    expect(PREVIEW_TOKENS).toEqual({ input: 2_500, output: 900 });
    expect(previewCostUsd("gemini-3.8-flash")).toBeCloseTo(0.00525, 6);
    expect(previewCostUsd("claude-opus-5-5")).toBeCloseTo(0.035, 6);
    expect(previewCostUsd("totally-unknown")).toBeNull();
  });
});
