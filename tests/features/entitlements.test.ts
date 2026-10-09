import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// What a company may use: its plan's features, minus those whose outside services are all switched off.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle-catalog", () => ({ paddleConnected: () => false, createPaddleProduct: vi.fn(), createPaddlePrice: vi.fn(), archivePaddlePrice: vi.fn(), updatePaddleProduct: vi.fn() }));

import { clearSwitchCache } from "@/lib/admin/switch";
import { assertFeature, companyFeatures, featureBlocked, featureErrorResponse, FeatureRequiredError, featureStatus, hasFeature, upgradeHref } from "@/lib/entitlements";
import { createPlan, updatePlan } from "@/lib/admin/plans-service";
import { getPlan, resetPlanCache, viewOf } from "@/lib/plan-catalog";
import { CORE_FEATURES, PRO_FEATURES } from "@/lib/plans";
import { consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");

function company(id: string, plan: string, status = "ACTIVE") {
  h.db.business.rows.push({ id, userId: `u_${id}`, user: { suspendedAt: null, subscription: { plan, status } } });
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

  it("reads a row from before the migration as the core plus its capabilities", () => {
    const old = viewOf({ id: "x", key: "legacy", name: "Legacy", limits: {}, features: ["Old bullet"], capabilities: { apiAccess: true } });
    expect(old.highlights).toEqual(["Old bullet"]);
    expect(old.features).toEqual([...CORE_FEATURES, "apiAccess"]);
    const fresh = viewOf({ id: "y", key: "new", name: "New", limits: {}, highlights: ["New bullet"], featureKeys: ["autopilot"], features: ["New bullet"], capabilities: {} });
    expect(fresh.highlights).toEqual(["New bullet"]);
    expect(fresh.features).toEqual(["content", "designs", "calendar", "gallery", "autopilot"]); // prerequisites are filled in on read
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
