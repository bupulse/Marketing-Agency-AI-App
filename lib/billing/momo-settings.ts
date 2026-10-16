import "server-only";
import type { BillingInterval, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { companyPlans } from "@/lib/region-prices";
import { sendPayDetailsChangedEmail } from "./momo-emails";
import { cleanMomoSettings, momoPriceOf, momoSettingsProblem, MOMO_SETTING_KEY, type MomoSettings } from "./momo-shared";

// The owner's Mobile Money details (where clients pay), one AdminSetting row (key "billing.momo"). Read on every pay
// screen, so it is cached briefly per isolate like the plan catalog; the writer clears its own cache. Prices are NOT
// here: a plan's Mobile Money price is its regional price (lib/region-prices.ts, Admin -> Regions and prices).

const TTL_MS = 30_000;
let cached: { at: number; value: MomoSettings } | null = null;

export function clearMomoSettingsCache() {
  cached = null;
}

export async function getMomoSettings(): Promise<MomoSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const row = await prisma.adminSetting.findUnique({ where: { key: MOMO_SETTING_KEY } });
    cached = { at: Date.now(), value: cleanMomoSettings(row?.value) };
  } catch {
    // The database blinking must not take the pay screen down: keep the last copy, or the empty settings (which hide MoMo).
    cached = { at: Date.now(), value: cached?.value ?? cleanMomoSettings(null) };
  }
  return cached.value;
}

/**
 * What a company pays by Mobile Money for a plan and interval: the plan's price in the company's region (never the
 * visitor's IP). Null when the plan is not offered there or the region does not take Mobile Money (docs/REGIONS.md).
 */
export async function getMomoPrice(businessId: string, planKey: string, interval: BillingInterval): Promise<{ amountMinor: number; currency: string } | null> {
  const { plans } = await companyPlans(businessId);
  const plan = plans.find((p) => p.key === planKey);
  return plan ? momoPriceOf(plan, interval) : null;
}

export type MomoSettingsInput = Partial<MomoSettings>;

const DETAIL_KEYS = ["merchantCode", "momoNumber", "airtelNumber"] as const;

/**
 * Saves the owner's details: refused (not truncated) when a code or number is malformed, audited with the stored
 * values read inside the transaction (never the cache), and every admin address is emailed when where clients pay
 * changes.
 */
export async function saveMomoSettings(ctx: AdminContext, input: MomoSettingsInput): Promise<MomoSettings> {
  if (ctx.viaApi) throw new AdminError("forbidden", "Payment details are changed in the admin console only.");
  const { before, after } = await prisma.$transaction(async (tx) => {
    const row = await tx.adminSetting.findUnique({ where: { key: MOMO_SETTING_KEY } });
    const before = cleanMomoSettings(row?.value);
    const merged = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])) };
    const problem = momoSettingsProblem(merged);
    if (problem) throw new AdminError("invalid", problem);
    const after = cleanMomoSettings(merged);
    await tx.adminSetting.upsert({ where: { key: MOMO_SETTING_KEY }, create: { key: MOMO_SETTING_KEY, value: after as Prisma.InputJsonObject }, update: { value: after as Prisma.InputJsonObject } });
    await writeAudit(tx, ctx, "set_momo_settings", `setting:${MOMO_SETTING_KEY}`, before, after);
    return { before, after };
  });
  clearMomoSettingsCache();
  if (DETAIL_KEYS.some((k) => before[k] !== after[k])) await sendPayDetailsChangedEmail(before, after, ctx.actor).catch(() => false);
  return after;
}
