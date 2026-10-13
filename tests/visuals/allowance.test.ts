import { beforeEach, describe, expect, it, vi } from "vitest";

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
    const sql = readFileSync("prisma/migrations/20261016090000_people_images/migration.sql", "utf8");
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
