import { beforeEach, describe, expect, it, vi } from "vitest";

// These tests import large server modules inside the test (actions, the visuals service): the first import
// can take several seconds when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

const prisma = vi.hoisted(() => ({ business: { findUnique: vi.fn() }, planDefinition: { findUnique: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { readFileSync } from "node:fs";
import { allowanceFor, clearAllowanceCache, companyAllowanceUsd } from "@/lib/ai/budget";
import { buildImagePrompt } from "@/lib/designs/prompt";
import { ADDONS, METRIC_LABEL } from "@/lib/offers/shared";
import { SEED_PLANS } from "@/lib/plans";

const plan = (key: string) => prisma.business.findUnique.mockResolvedValue({ user: { subscription: { plan: key } } });

describe("AI images and allowance by plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllowanceCache();
    delete process.env.AI_COMPANY_MONTHLY_USD;
  });

  it("the company allowance follows the plan: Starter/Standard $2, Business/Pro $6, trial $1; the env is the fallback", async () => {
    plan("BUSINESS");
    prisma.planDefinition.findUnique.mockResolvedValue({ aiMonthlyUsd: 6 });
    expect(await companyAllowanceUsd("b1")).toBe(6);
    plan("STANDARD");
    prisma.planDefinition.findUnique.mockResolvedValue({ aiMonthlyUsd: null });
    expect(await companyAllowanceUsd("b2")).toBe(2); // the code's seed plan
    plan("CUSTOM-x");
    prisma.planDefinition.findUnique.mockResolvedValue({ aiMonthlyUsd: null });
    process.env.AI_COMPANY_MONTHLY_USD = "4";
    expect(await companyAllowanceUsd("b3")).toBe(4);
    prisma.business.findUnique.mockRejectedValue(new Error("db down"));
    expect(await companyAllowanceUsd("b4")).toBe(4);
    expect([SEED_PLANS.TRIAL.aiMonthlyUsd, SEED_PLANS.STANDARD.aiMonthlyUsd, SEED_PLANS.PRO.aiMonthlyUsd]).toEqual([1, 2, 6]);
    expect(allowanceFor(-1, 3)).toBe(3);
    expect(allowanceFor(0, 3)).toBe(0);
  });

  it("the migration stores the allowance and the AI image limits per plan, and keeps the image pack price", () => {
    const sql = readFileSync("prisma/migrations/20261016130000_people_images/migration.sql", "utf8");
    expect(sql).toMatch(/SET "aiMonthlyUsd" = 2 WHERE "key" IN \('STARTER', 'STANDARD'\)/);
    expect(sql).toMatch(/SET "aiMonthlyUsd" = 6 WHERE "key" IN \('BUSINESS', 'PRO'\)/);
    expect(sql).toMatch(/SET "aiMonthlyUsd" = 1 WHERE "isTrial" = true/);
    expect(sql).toMatch(/'block:image', 'RW', 'RWF', 5000/);
    expect(ADDONS.find((a) => a.key === "block:image")).toMatchObject({ kind: "block", metric: "image", blockSize: 50, label: "Image pack (+50 AI images)" });
    expect(METRIC_LABEL.image).toBe("AI images a month");
  });

  it("the image prompt keeps people safe: no real or famous people, adults only, nothing medical", () => {
    const prompt = buildImagePrompt({ business: { name: "Kigali Phones", country: "Rwanda" }, prompt: "a woman holding a phone", aspectRatio: "4:5", hasPhoto: true });
    expect(prompt).toMatch(/Never show a real, famous or recognisable person/);
    expect(prompt).toMatch(/Adults only, no children/);
    expect(prompt).toMatch(/no before-and-after/);
    expect(prompt).toMatch(/local people in Rwanda/);
    expect(prompt).toMatch(/Do not put any text, letters, numbers, watermarks or logos in the image/);
  });
});

describe("review fixes: image packs, custom plans, refill date, render lease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllowanceCache();
    delete process.env.AI_COMPANY_MONTHLY_USD;
  });

  it("an image pack raises the dollar allowance by what its 50 images cost (rounded up), so it is always usable", async () => {
    const { imageUnitUsd, packAllowanceUsd, derivedAllowanceUsd } = await import("@/lib/ai/budget");
    const { customAllowanceUsd, imagePacks } = await import("@/lib/offers/allowance");
    expect(imageUnitUsd()).toBe(0.039);
    expect(packAllowanceUsd(1)).toBe(2); // 50 x $0.039 = $1.95
    expect(packAllowanceUsd(3)).toBe(6); // $5.85
    expect(packAllowanceUsd(0)).toBe(0);
    const lines = [{ key: "plan:BUSINESS", quantity: 1 }, { key: "block:image", quantity: 2 }, { key: "seat", quantity: 1 }];
    expect(imagePacks(lines)).toBe(2);
    // Business ($6) with two packs: $6 + $4.
    expect(customAllowanceUsd({ baseUsd: 6, lines, limits: { image: 200 } })).toBe(10);
    // No base plan (features only): its images at cost x 1.5 plus $1 for text, not the $3 default.
    expect(customAllowanceUsd({ baseUsd: null, lines: [], limits: { image: 100 } })).toBe(derivedAllowanceUsd(100));
    expect(derivedAllowanceUsd(100)).toBe(Math.ceil(100 * 0.039 * 1.5 + 1));
  });

  it("a custom plan row without an allowance gets one from its image limit", async () => {
    plan("CUSTOM-ABC");
    prisma.planDefinition.findUnique.mockResolvedValue({ aiMonthlyUsd: null, limits: { image: 150 } });
    const { derivedAllowanceUsd } = await import("@/lib/ai/budget");
    expect(await companyAllowanceUsd("b9")).toBe(derivedAllowanceUsd(150));
  });

  it("offers set the custom plan's allowance when they are accepted", () => {
    const src = readFileSync("lib/offers/service.ts", "utf8");
    expect(src).toMatch(/customAllowanceUsd\(\{ baseUsd: .*lines: row\.lines, limits: row\.limits \}\)/);
    expect(src).toMatch(/isCustom: true,\s+businessId: input\.businessId,\s+aiMonthlyUsd,/);
  });

  it("the render lease outlasts the slowest AI photo call (attempts, retries and waits inside one budget) plus drawing", async () => {
    const { RENDER_LEASE_MS } = await import("@/lib/visuals/service");
    const { GEMINI_IMAGE_BUDGET_MS } = await import("@/lib/ai/gemini-image");
    expect(GEMINI_IMAGE_BUDGET_MS).toBe(120_000);
    expect(RENDER_LEASE_MS).toBeGreaterThanOrEqual(GEMINI_IMAGE_BUDGET_MS + 60_000);
    expect(readFileSync("lib/ai/gemini-image.ts", "utf8")).toContain("GEMINI_IMAGE_BUDGET_MS,\n");
  });
});
