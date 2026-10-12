import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// What a company may use: its plan's features, minus those whose outside services are all switched off.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));

import { clearSwitchCache } from "@/lib/admin/switch";
import { accountBlock, assertFeature, blockMessage, blockReason, companyEntitlements, companyFeatures, featureBlocked, featureErrorResponse, FeatureRequiredError, featureStatus, hasFeature, PLAN_UNKNOWN_MESSAGE, upgradeHref } from "@/lib/entitlements";
import { createPlan, updatePlan } from "@/lib/admin/plans-service";
import { getPlan, resetPlanCache, viewOf } from "@/lib/plan-catalog";
import { CORE_FEATURES, PRO_FEATURES } from "@/lib/plans";
import { consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");

function company(id: string, plan: string, status = "ACTIVE", extra: Record<string, unknown> = {}) {
  h.db.business.rows.push({ id, userId: `u_${id}`, user: { suspendedAt: null, subscription: { plan, status, chosenPlan: null, trialEndsAt: null, ...extra } } });
}

beforeEach(() => {
  h.db = createFakeDb();
  resetPlanCache();
  clearSwitchCache();
  company("std", "STANDARD");
  company("pro", "PRO");
});

describe("companyFeatures", () => {
  it("is the plan's feature list: Standard has the core, Pro everything, an unknown company nothing", async () => {
    expect([...(await companyFeatures("std"))]).toEqual(CORE_FEATURES);
    expect([...(await companyFeatures({ businessId: "pro" }))]).toEqual(PRO_FEATURES);
    expect((await companyFeatures("nobody")).size).toBe(0);
    expect((await companyFeatures("")).size).toBe(0);
  });

  it("drops a feature while all of its outside services are off, and keeps it while one is on", async () => {
    h.db.serviceSwitch.rows.push({ service: "canva", enabled: false }, { service: "shopify", enabled: false });
    clearSwitchCache();
    expect(await featureStatus("pro", "canva")).toBe("service_off");
    expect(await featureStatus("pro", "storeImport")).toBe("ok"); // WooCommerce is still on
    expect(await featureStatus("pro", "websiteChat")).toBe("ok"); // works without the AI
    expect(await featureStatus("std", "apiAccess")).toBe("not_in_plan");
    expect(await hasFeature("pro", "canva")).toBe(false);
    expect(await hasFeature("pro", "autopilot")).toBe(true);
  });

  it("follows plan edits (through the plan cache) and the capabilities alias", async () => {
    await createPlan(CONSOLE, { key: "starter", name: "Starter", monthlyPriceCents: 1000, yearlyPriceCents: 10000, features: ["content", "designs", "calendar", "gallery"] });
    company("rw", "starter");
    expect([...(await companyFeatures("rw"))]).toEqual(["content", "designs", "calendar", "gallery"]);
    await updatePlan(CONSOLE, "starter", { features: ["content", "designs", "calendar", "gallery", "websiteChat"], capabilities: { apiAccess: true } });
    expect([...(await companyFeatures("rw"))]).toEqual(["content", "designs", "calendar", "gallery", "websiteChat", "apiAccess"]);
    // The legacy column follows the features, so anything still reading it stays right.
    expect(h.db.planDefinition.rows.find((r) => r.key === "starter")!.capabilities).toEqual({ apiAccess: true, ownComposio: false });
  });
});

describe("a plan's features are validated when saved", () => {
  it("refuses a missing prerequisite, an unknown key and a coming-soon feature, with the reason", async () => {
    const code = async (p: Promise<unknown>) => p.then(() => null, (e: { code: string; message: string }) => `${e.code}: ${e.message}`);
    expect(await code(updatePlan(CONSOLE, "STANDARD", { features: ["autopilot"] }))).toMatch(/^invalid: AI content is needed by Autopilot/);
    expect(await code(updatePlan(CONSOLE, "STANDARD", { features: ["content", "video"] }))).toMatch(/^invalid: Video generation is coming soon/);
    expect(await code(updatePlan(CONSOLE, "STANDARD", { features: ["content", "nope"] }))).toMatch(/^invalid: "nope" is not a feature/);
    expect((await getPlan("STANDARD"))!.features).toEqual(CORE_FEATURES);
  });

  it("reads a row from before the migration, or one an older build wrote after it (featureKeys NULL), as the core plus its capabilities", () => {
    const old = viewOf({ id: "x", key: "legacy", name: "Legacy", limits: {}, features: ["Old bullet"], capabilities: { apiAccess: true } });
    expect(old.highlights).toEqual(["Old bullet"]);
    expect(old.features).toEqual([...CORE_FEATURES, "apiAccess"]);
    const dual = viewOf({ id: "z", key: "dual", name: "Dual", limits: {}, highlights: [], featureKeys: null, features: [], capabilities: { ownComposio: true } });
    expect(dual.features).toEqual([...CORE_FEATURES, "ownComposio"]);
    // An array is the plan's own list, even when empty: an admin may sell a plan with nothing in it.
    expect(viewOf({ id: "e", key: "empty", name: "Empty", limits: {}, featureKeys: [], features: [], capabilities: { apiAccess: true } }).features).toEqual([]);
    const fresh = viewOf({ id: "y", key: "new", name: "New", limits: {}, highlights: ["New bullet"], featureKeys: ["autopilot"], features: ["New bullet"], capabilities: {} });
    expect(fresh.highlights).toEqual(["New bullet"]);
    expect(fresh.features).toEqual(["content", "designs", "calendar", "gallery", "autopilot"]); // prerequisites are filled in on read
  });
});

describe("a plan that cannot be resolved", () => {
  it("is 'plan_unknown', not 'not_in_plan': a company on a plan the catalog does not have, or without a plan, has lost nothing", async () => {
    company("custom", "rw_starter"); // the row is on a custom plan, but the catalog (seeds, while the database is unreadable) has no such key
    expect((await companyEntitlements("custom")).resolved).toBe(false);
    expect(await featureStatus("custom", "calendar")).toBe("plan_unknown");
    expect(await featureStatus("nobody", "calendar")).toBe("plan_unknown");
    expect(await featureStatus("", "calendar")).toBe("plan_unknown");
    expect(blockReason(await companyEntitlements("custom"), "calendar")).toBe("plan_unknown");
    expect(await hasFeature("custom", "calendar")).toBe(false); // still not usable: gates stay closed
    // Once the plan exists in the catalog, the same company resolves and the answer becomes definite.
    await createPlan(CONSOLE, { key: "rw_starter", name: "Starter", monthlyPriceCents: 1000, yearlyPriceCents: 10000, features: ["content"] });
    expect((await companyEntitlements("custom")).resolved).toBe(true);
    expect(await featureStatus("custom", "content")).toBe("ok");
    expect(await featureStatus("custom", "calendar")).toBe("not_in_plan");
    expect(blockReason(await companyEntitlements("std"), "apiAccess")).toBe("not_in_plan");
  });

  it("is told apart in words and answered 503 (temporary), never 403 (not in the plan)", async () => {
    const error = await assertFeature("nobody", "autopilot").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FeatureRequiredError);
    expect((error as FeatureRequiredError).reason).toBe("plan_unknown");
    expect((error as FeatureRequiredError).message).toBe(PLAN_UNKNOWN_MESSAGE);
    expect(featureErrorResponse(error as FeatureRequiredError).status).toBe(503);
    expect(await featureBlocked("nobody", "autopilot")).toBe(PLAN_UNKNOWN_MESSAGE);
    expect(upgradeHref("autopilot", "plan_unknown")).toBe("/dashboard/upgrade?feature=autopilot&reason=plan_unknown");
  });
});

describe("a read-only account", () => {
  it("is told apart (pure): demo pending, trial over, past due, ended; a live trial or paid plan is not blocked", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    expect(accountBlock({ plan: "TRIAL", status: "PENDING_DEMO", chosenPlan: "STARTER" }, now)).toBe("pending_demo");
    expect(accountBlock({ plan: "TRIAL", status: "TRIALING", chosenPlan: "STARTER", trialEndsAt: new Date("2026-10-12T09:00:00Z") }, now)).toBe("trial_expired");
    expect(accountBlock({ plan: "TRIAL", status: "TRIALING", chosenPlan: "STARTER", trialEndsAt: new Date("2026-10-13T09:00:00Z") }, now)).toBeNull();
    expect(accountBlock({ plan: "TRIAL", status: "EXPIRED", chosenPlan: null, trialEndsAt: new Date("2026-10-01T09:00:00Z") }, now)).toBe("trial_expired");
    expect(accountBlock({ plan: "STANDARD", status: "PAST_DUE", chosenPlan: null }, now)).toBe("past_due");
    expect(accountBlock({ plan: "STANDARD", status: "CANCELED", chosenPlan: null }, now)).toBe("inactive");
    expect(accountBlock({ plan: "STANDARD", status: "ACTIVE", chosenPlan: null }, now)).toBeNull();
    expect(accountBlock(null, now)).toBeNull();
  });

  it("keeps its plan for viewing but may act on nothing: every gate answers not_in_plan (403, never 503) with the reason why", async () => {
    company("pending", "TRIAL", "PENDING_DEMO", { chosenPlan: "PRO" });
    company("expired", "TRIAL", "EXPIRED", { trialEndsAt: new Date("2026-10-01T00:00:00Z") });
    company("due", "PRO", "PAST_DUE");
    // Waiting for the demo: nothing at all, and a definite answer (the plan is not "unknown").
    const pending = await companyEntitlements("pending");
    expect(pending).toMatchObject({ resolved: true, block: "pending_demo" });
    expect(pending.inPlan.size).toBe(0);
    expect(await featureStatus("pending", "content")).toBe("not_in_plan");
    const error = await assertFeature("pending", "content").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FeatureRequiredError);
    expect((error as FeatureRequiredError).message).toBe(blockMessage("pending_demo"));
    expect(featureErrorResponse(error as FeatureRequiredError).status).toBe(403);
    // Trial over: the TRIAL plan's features stay listed (pages render, data can be looked at), nothing may be done.
    const expired = await companyEntitlements("expired");
    expect(expired.block).toBe("trial_expired");
    expect(expired.usable.has("content")).toBe(true);
    expect(await featureStatus("expired", "content")).toBe("not_in_plan");
    expect(await hasFeature("expired", "calendar")).toBe(false);
    expect(await featureBlocked("expired", "calendar")).toBe(blockMessage("trial_expired"));
    // Past due on a paid plan: the same.
    expect(await featureStatus("due", "autopilot")).toBe("not_in_plan");
    expect(await featureBlocked("due", "autopilot")).toMatch(/payment did not go through/);
    // A paying company is unaffected.
    expect(await featureStatus("pro", "autopilot")).toBe("ok");
  });
});

describe("assertFeature and friends", () => {
  it("throws a typed error with a message a client can read, and routes answer 403 or 503", async () => {
    await expect(assertFeature("pro", "autopilot")).resolves.toBeUndefined();
    const missing = await assertFeature("std", "apiAccess").catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(FeatureRequiredError);
    expect((missing as FeatureRequiredError).message).toBe("API access is not part of your plan. Add it to your plan to use it.");
    const res = featureErrorResponse(missing as FeatureRequiredError);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "feature_required", feature: "apiAccess", reason: "not_in_plan", message: "API access is not part of your plan. Add it to your plan to use it." });

    h.db.serviceSwitch.rows.push({ service: "gemini", enabled: false });
    clearSwitchCache();
    const off = await assertFeature("pro", "aiPhotos").catch((e: unknown) => e);
    expect((off as FeatureRequiredError).reason).toBe("service_off");
    expect(featureErrorResponse(off as FeatureRequiredError).status).toBe(503);
  });

  it("featureBlocked gives the message or null, and upgradeHref points at the page", async () => {
    expect(await featureBlocked("pro", "webhooks")).toBeNull();
    expect(await featureBlocked("std", "apiAccess")).toMatch(/not part of your plan/);
    expect(upgradeHref("autopilot")).toBe("/dashboard/upgrade?feature=autopilot");
    expect(upgradeHref("canva", "service_off")).toBe("/dashboard/upgrade?feature=canva&reason=service_off");
  });
});
