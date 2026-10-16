import "server-only";
import { prisma } from "@/lib/db";
import { getPlans } from "@/lib/plan-catalog";
import { clearRegionCache, getRegions } from "@/lib/region";
import { cardUsdCents, DEFAULT_REGION_KEY, isPaymentMethod, isRegionKey, type PaymentMethod, type RegionInfo } from "@/lib/region-format";
import { clearRegionPriceCache, getRegionPrices, type RegionPriceRow } from "@/lib/region-prices";
import { CLEARED_MISMATCH, parseMismatch } from "@/lib/region-check";
import type { Prisma } from "@/lib/generated/prisma/client";
import { writeAudit } from "./audit";
import { getSettings } from "./settings";
import { AdminError, type AdminContext } from "./types";

// Regions and regional prices (Admin -> Settings -> Regions, and the Jarvis read tools). Every change is audited.
// GLOBAL prices are the plans' own (plan builder); the other regions' prices live here, with the card (USD) price of
// a local-currency plan computed from the admin's USD rate and card margin. Creating the Paddle prices for RW and
// EAC card payments is a documented TODO (docs/REGIONS.md): nothing here calls Paddle.

export type RegionInput = {
  key: string;
  name: string;
  currency: string;
  countries: string[];
  paymentMethods: string[];
  active?: boolean;
  sortOrder?: number;
};

const COUNTRY = /^[A-Z]{2}$/;

function cleanRegion(input: RegionInput): RegionInfo {
  const key = String(input.key ?? "").trim().toUpperCase();
  if (!isRegionKey(key)) throw new AdminError("invalid", "The key is 2-16 capital letters, digits or _, starting with a letter (for example RW).");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60) throw new AdminError("invalid", "The name is required (max 60 characters).");
  const currency = String(input.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new AdminError("invalid", "The currency is a 3-letter code such as RWF or USD.");
  const countries = [...new Set((input.countries ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  const bad = countries.find((c) => !COUNTRY.test(c));
  if (bad) throw new AdminError("invalid", `"${bad}" is not a 2-letter country code.`);
  const paymentMethods = [...new Set((input.paymentMethods ?? []).map((m) => String(m).trim().toLowerCase()))];
  if (paymentMethods.length === 0 || !paymentMethods.every(isPaymentMethod)) throw new AdminError("invalid", "Choose at least one payment method: momo or card.");
  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < -1000 || sortOrder > 1000) throw new AdminError("invalid", "The order must be a whole number from -1000 to 1000.");
  return { key, name, currency, countries, paymentMethods: paymentMethods as PaymentMethod[], active: input.active !== false, sortOrder };
}

/** Creates or updates a region. The catch-all region (no countries) cannot be switched off: someone has to see prices. */
export async function saveRegion(ctx: AdminContext, input: RegionInput): Promise<RegionInfo> {
  const next = cleanRegion(input);
  const current = (await getRegions({ force: true })).find((r) => r.key === next.key) ?? null;
  if (current && current.countries.length === 0 && !next.active) throw new AdminError("conflict", `${current.name} takes every country the other regions do not list, so it cannot be switched off.`);
  const otherCatchAll = (await getRegions()).find((r) => r.key !== next.key && r.active && r.countries.length === 0);
  if (next.countries.length === 0 && next.active && otherCatchAll) throw new AdminError("conflict", `${otherCatchAll.name} already takes every other country. Give this region a country list.`);
  const clash = (await getRegions()).find((r) => r.key !== next.key && r.active && r.countries.some((c) => next.countries.includes(c)));
  if (clash && next.active) throw new AdminError("conflict", `${clash.name} already lists ${clash.countries.filter((c) => next.countries.includes(c)).join(", ")}. A country belongs to one region.`);
  await prisma.$transaction(async (tx) => {
    await tx.pricingRegion.upsert({
      where: { key: next.key },
      create: { key: next.key, name: next.name, currency: next.currency, countries: next.countries, paymentMethods: next.paymentMethods, active: next.active, sortOrder: next.sortOrder },
      update: { name: next.name, currency: next.currency, countries: next.countries, paymentMethods: next.paymentMethods, active: next.active, sortOrder: next.sortOrder },
    });
    await writeAudit(tx, ctx, current ? "update_region" : "create_region", `region:${next.key}`, current, next);
  });
  clearRegionCache();
  return next;
}

export type RegionPriceInput = { planKey: string; regionKey: string; monthlyMinor: number; yearlyMinor: number };

/** The card price of a local amount with the current settings, for previews and for saving. */
export async function cardPriceFor(minor: number, currency: string): Promise<number> {
  const s = await getSettings();
  return cardUsdCents(minor, currency, s.usdToRwf, s.cardMarginPercent);
}

const MAX_MINOR = 1_000_000_000;

/** Sets a plan's price in a region (not GLOBAL: those prices are the plan builder's). Audited; the card price is derived. */
export async function setRegionPrice(ctx: AdminContext, input: RegionPriceInput): Promise<RegionPriceRow> {
  const region = (await getRegions({ force: true })).find((r) => r.key === String(input.regionKey ?? "").toUpperCase());
  if (!region) throw new AdminError("not_found", "No region with that key.");
  if (region.key === DEFAULT_REGION_KEY || region.countries.length === 0) throw new AdminError("conflict", `${region.name} prices are the plans' own prices: change them in Plans.`);
  const plan = (await getPlans({ force: true })).find((p) => p.key === input.planKey);
  if (!plan) throw new AdminError("not_found", "No plan with that key.");
  if (plan.isTrial) throw new AdminError("conflict", "The free trial has no price.");
  for (const [field, value] of [["monthly", input.monthlyMinor], ["yearly", input.yearlyMinor]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_MINOR) throw new AdminError("invalid", `The ${field} price must be a whole amount in ${region.currency}${region.currency === "USD" ? " cents" : ""} from 1 to ${MAX_MINOR}.`);
  }
  const card = region.currency === "USD" ? { monthly: input.monthlyMinor, yearly: input.yearlyMinor } : { monthly: await cardPriceFor(input.monthlyMinor, region.currency), yearly: await cardPriceFor(input.yearlyMinor, region.currency) };
  const before = (await getRegionPrices({ force: true })).find((p) => p.planKey === plan.key && p.regionKey === region.key) ?? null;
  const next = { planKey: plan.key, regionKey: region.key, currency: region.currency, monthlyMinor: input.monthlyMinor, yearlyMinor: input.yearlyMinor, cardMonthlyUsdCents: card.monthly, cardYearlyUsdCents: card.yearly };
  await prisma.$transaction(async (tx) => {
    await tx.planRegionPrice.upsert({
      where: { planKey_regionKey: { planKey: plan.key, regionKey: region.key } },
      create: next,
      // A price change makes the old Paddle prices wrong: they are cleared, and the sync (TODO) creates new ones.
      update: { ...next, ...(before && (before.monthlyMinor !== next.monthlyMinor || before.yearlyMinor !== next.yearlyMinor) ? { paddleMonthlyPriceId: null, paddleYearlyPriceId: null } : {}) },
    });
    await writeAudit(tx, ctx, before ? "update_region_price" : "create_region_price", `plan:${plan.key}`, before, next);
  });
  clearRegionPriceCache();
  return (await getRegionPrices({ force: true })).find((p) => p.planKey === plan.key && p.regionKey === region.key)!;
}

/** Stops offering a plan in a region. Clients already on it keep it. */
export async function removeRegionPrice(ctx: AdminContext, input: { planKey: string; regionKey: string }) {
  const before = (await getRegionPrices({ force: true })).find((p) => p.planKey === input.planKey && p.regionKey === input.regionKey);
  if (!before) throw new AdminError("not_found", "That plan has no price in that region.");
  await prisma.$transaction(async (tx) => {
    await tx.planRegionPrice.deleteMany({ where: { planKey: input.planKey, regionKey: input.regionKey } });
    await writeAudit(tx, ctx, "delete_region_price", `plan:${input.planKey}`, before, null);
  });
  clearRegionPriceCache();
  return { planKey: input.planKey, regionKey: input.regionKey };
}

/**
 * Recomputes every local-currency card price from the current USD rate and margin ("Update card prices"). The Paddle
 * prices behind them are not touched here (TODO: create new Paddle prices and move subscribers through the existing
 * price-change flow). Returns how many rows changed.
 */
export async function recomputeCardPrices(ctx: AdminContext): Promise<{ changed: number }> {
  const s = await getSettings();
  const rows = (await getRegionPrices({ force: true })).filter((r) => r.currency !== "USD");
  let changed = 0;
  for (const r of rows) {
    const monthly = cardUsdCents(r.monthlyMinor, r.currency, s.usdToRwf, s.cardMarginPercent);
    const yearly = cardUsdCents(r.yearlyMinor, r.currency, s.usdToRwf, s.cardMarginPercent);
    if (monthly === r.cardMonthlyUsdCents && yearly === r.cardYearlyUsdCents) continue;
    changed++;
    await prisma.$transaction(async (tx) => {
      await tx.planRegionPrice.updateMany({ where: { planKey: r.planKey, regionKey: r.regionKey }, data: { cardMonthlyUsdCents: monthly, cardYearlyUsdCents: yearly, paddleMonthlyPriceId: null, paddleYearlyPriceId: null } });
      await writeAudit(tx, ctx, "update_card_prices", `plan:${r.planKey}`, { regionKey: r.regionKey, cardMonthlyUsdCents: r.cardMonthlyUsdCents, cardYearlyUsdCents: r.cardYearlyUsdCents }, { regionKey: r.regionKey, cardMonthlyUsdCents: monthly, cardYearlyUsdCents: yearly, usdToRwf: s.usdToRwf, cardMarginPercent: s.cardMarginPercent });
    });
  }
  clearRegionPriceCache();
  return { changed };
}

/** Moves a company to another region (its billing prices and payment methods). Audited on the business. Clears an open region mismatch. */
export async function setCompanyRegion(ctx: AdminContext, input: { businessId: string; regionKey: string }) {
  const key = String(input.regionKey ?? "").toUpperCase();
  const region = (await getRegions({ force: true })).find((r) => r.key === key);
  if (!region) throw new AdminError("not_found", "No region with that key.");
  if (!region.active) throw new AdminError("conflict", `${region.name} is switched off.`);
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, pricingRegion: true } });
  if (!business) throw new AdminError("not_found", "No company with that id.");
  if (business.pricingRegion === key) return { businessId: business.id, pricingRegion: key, changed: false };
  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: business.id }, data: { pricingRegion: key, ...CLEARED_MISMATCH } });
    await writeAudit(tx, ctx, "update_company_region", `business:${business.id}`, { pricingRegion: business.pricingRegion }, { pricingRegion: key });
  });
  return { businessId: business.id, pricingRegion: key, changed: true };
}

/**
 * The admin looked at a region mismatch (lib/region-check.ts) and keeps the company's region (a traveller, a VPN).
 * The flag stays on the company as dismissed, so the same country is not raised again. Audited.
 */
export async function dismissRegionMismatch(ctx: AdminContext, input: { businessId: string }) {
  const business = await prisma.business.findUnique({ where: { id: String(input.businessId ?? "") }, select: { id: true, pricingRegion: true, regionMismatch: true, regionMismatchAt: true } });
  if (!business) throw new AdminError("not_found", "No company with that id.");
  const flag = parseMismatch(business.regionMismatch);
  if (!flag || !business.regionMismatchAt) return { businessId: business.id, changed: false };
  const dismissed = { ...flag, dismissedAt: new Date().toISOString() };
  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: business.id }, data: { regionMismatch: dismissed as unknown as Prisma.InputJsonValue, regionMismatchAt: null } });
    await writeAudit(tx, ctx, "dismiss_region_mismatch", `business:${business.id}`, { regionMismatch: flag }, { pricingRegion: business.pricingRegion, dismissedAt: dismissed.dismissedAt });
  });
  return { businessId: business.id, changed: true };
}

/** Regions with their prices per plan, for the admin page and the Jarvis tools. */
export async function listRegionsAdmin() {
  const [regions, prices, plans, settings] = await Promise.all([getRegions({ force: true }), getRegionPrices({ force: true }), getPlans({ force: true }), getSettings()]);
  const paid = plans.filter((p) => !p.isTrial);
  return {
    settings: { usdToRwf: settings.usdToRwf, cardMarginPercent: settings.cardMarginPercent },
    regions: regions.map((r) => {
      const isGlobal = r.countries.length === 0;
      return {
        ...r,
        prices: paid.flatMap((p) => {
          const row = prices.find((x) => x.planKey === p.key && x.regionKey === r.key);
          if (isGlobal) {
            const pricedAnywhere = prices.some((x) => x.planKey === p.key);
            if (!row && pricedAnywhere) return [];
            return [{ planKey: p.key, planName: p.name, planStatus: p.status, currency: p.currency, monthlyMinor: p.monthlyPriceCents, yearlyMinor: p.yearlyPriceCents, cardMonthlyUsdCents: p.monthlyPriceCents, cardYearlyUsdCents: p.yearlyPriceCents, paddleMonthlyPriceId: p.paddleMonthlyPriceId, paddleYearlyPriceId: p.paddleYearlyPriceId, fromPlan: true }];
          }
          if (!row) return [];
          return [{ planKey: p.key, planName: p.name, planStatus: p.status, currency: row.currency, monthlyMinor: row.monthlyMinor, yearlyMinor: row.yearlyMinor, cardMonthlyUsdCents: row.cardMonthlyUsdCents, cardYearlyUsdCents: row.cardYearlyUsdCents, paddleMonthlyPriceId: row.paddleMonthlyPriceId, paddleYearlyPriceId: row.paddleYearlyPriceId, fromPlan: false }];
        }),
      };
    }),
    plans: paid.map((p) => ({ key: p.key, name: p.name, status: p.status })),
  };
}
