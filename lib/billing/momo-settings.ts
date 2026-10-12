import "server-only";
import type { BillingInterval, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { getPlan, getSellablePlans } from "@/lib/plan-catalog";
import { sendPayDetailsChangedEmail } from "./momo-emails";
import { cleanMomoSettings, momoPriceFor, momoSettingsProblem, MOMO_SETTING_KEY, type MomoPlanPrice, type MomoSettings } from "./momo-shared";

// The owner's Mobile Money details and RWF prices, one AdminSetting row (key "billing.momo"). Read on every pay
// screen, so it is cached briefly per isolate like the plan catalog; the writer clears its own cache.

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

/** The RWF price of a plan and interval, or null when the plan does not exist. */
export async function getMomoPrice(planKey: string, interval: BillingInterval): Promise<{ amountMinor: number; currency: string } | null> {
  const plan = await getPlan(planKey);
  if (!plan) return null;
  return { amountMinor: momoPriceFor(plan, interval, await getMomoSettings()), currency: "RWF" };
}

/** Every sellable plan with its RWF prices, for the admin settings form and the Billing page. */
export async function getMomoPriceTable(): Promise<{ key: string; name: string; monthlyMinor: number; yearlyMinor: number; own: boolean }[]> {
  const [plans, settings] = await Promise.all([getSellablePlans(), getMomoSettings()]);
  return plans.map((p) => ({ key: p.key, name: p.name, monthlyMinor: momoPriceFor(p, "MONTH", settings), yearlyMinor: momoPriceFor(p, "YEAR", settings), own: p.key in settings.prices }));
}

export type MomoSettingsInput = Partial<Omit<MomoSettings, "prices">> & { prices?: Record<string, MomoPlanPrice | null> };

const DETAIL_KEYS = ["merchantCode", "momoNumber", "airtelNumber"] as const;

/**
 * Saves the owner's details: refused (not truncated) when a code or number is malformed, audited with the stored
 * values read inside the transaction (never the cache), and every admin address is emailed when where clients pay
 * changes. A plan price set to null goes back to the converted USD price.
 */
export async function saveMomoSettings(ctx: AdminContext, input: MomoSettingsInput): Promise<MomoSettings> {
  if (ctx.viaApi) throw new AdminError("forbidden", "Payment details are changed in the admin console only.");
  for (const key of Object.keys(input.prices ?? {})) {
    if (!(await getPlan(key))) throw new AdminError("invalid", `There is no plan with the key ${key}.`);
  }
  const { before, after } = await prisma.$transaction(async (tx) => {
    const row = await tx.adminSetting.findUnique({ where: { key: MOMO_SETTING_KEY } });
    const before = cleanMomoSettings(row?.value);
    const prices = { ...before.prices };
    for (const [key, price] of Object.entries(input.prices ?? {})) {
      if (price === null) delete prices[key];
      else {
        if (!Number.isInteger(price.monthlyMinor) || !Number.isInteger(price.yearlyMinor) || price.monthlyMinor < 0 || price.yearlyMinor < 0) throw new AdminError("invalid", "Prices are whole francs, 0 or more.");
        prices[key] = { monthlyMinor: price.monthlyMinor, yearlyMinor: price.yearlyMinor };
      }
    }
    const { prices: _ignored, ...details } = input;
    void _ignored;
    const merged = { ...before, ...Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])), prices };
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
