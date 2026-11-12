import "server-only";
import { prisma } from "@/lib/db";
import { getPlans } from "@/lib/plan-catalog";
import { clearRegionCache, getRegions } from "@/lib/region";
import { cardUsdCents, DEFAULT_REGION_KEY, isPaymentMethod, isRegionKey, regionStatus, type PaymentMethod, type RegionInfo, type RegionStatus } from "@/lib/region-format";
import { isIsoCountry } from "@/lib/iso-countries";
import { DEFAULT_VAT_LABEL, MAX_VAT_BPS } from "@/lib/vat";
import { clearRegionPriceCache, getRegionPrices, type RegionPriceRow } from "@/lib/region-prices";
import { CLEARED_MISMATCH, parseMismatch } from "@/lib/region-check";
import type { Prisma } from "@/lib/generated/prisma/client";
import { writeAudit } from "./audit";
import { getSettings } from "./settings";
import { AdminError, type AdminContext } from "./types";

// Regions and regional prices (Admin -> Regions, the plan form's "Where it is shown", and the Jarvis read tools). Every
// change is audited. Regions are LIVE or COMING_SOON (PricingRegion.active), carry their countries (each country in at
// most one region) and their VAT rate.
// GLOBAL prices are the plans' own (plan builder); the other regions' prices live here, with the card (USD) price of
// a local-currency plan computed from the admin's USD rate and card margin. Creating the Paddle prices for RW and
// EAC card payments is a documented TODO (docs/REGIONS.md): nothing here calls Paddle.

export type RegionInput = {
  /** Blank on a new region: made from the name ("West Africa" -> WEST_AFRICA). */
  key: string;
  name: string;
  currency: string;
  countries: string[];
  paymentMethods: string[];
  /** true = LIVE, false = COMING_SOON. */
  active?: boolean;
  sortOrder?: number;
  /** VAT in basis points (1800 = 18%); 0 = none. Left out keeps the region's current rate. */
  vatRateBps?: number;
  vatLabel?: string;
  /** Countries another region lists move here (the admin picked "Move here"); otherwise such a clash is refused. */
  move?: boolean;
  /** The new-region form: refused when the key is taken, instead of overwriting that region. */
  isNew?: boolean;
};

const COUNTRY = /^[A-Z]{2}$/;
const MAX_MINOR = 1_000_000_000;

/** "West Africa" -> "WEST_AFRICA" (a region key: capitals, digits and _, 2 to 16 long, starting with a letter). */
export function regionKeyFromName(name: string): string {
  const k = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^[^A-Z]+/, "").replace(/_+$/, "").slice(0, 16).replace(/_+$/, "");
  return k.length >= 2 ? k : "";
}

function cleanRegion(input: RegionInput, current: RegionInfo | null): RegionInfo & { vatRateBps: number; vatLabel: string } {
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60) throw new AdminError("invalid", "The name is required (max 60 characters).");
  const key = (String(input.key ?? "").trim().toUpperCase() || regionKeyFromName(name));
  if (!isRegionKey(key)) throw new AdminError("invalid", "The key is 2-16 capital letters, digits or _, starting with a letter (for example RW).");
  const currency = String(input.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new AdminError("invalid", "The currency is a 3-letter code such as RWF or USD.");
  const countries = [...new Set((input.countries ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  const bad = countries.find((c) => !COUNTRY.test(c) || !isIsoCountry(c));
  if (bad) throw new AdminError("invalid", `"${bad}" is not a country code (ISO 3166-1, two letters such as KE).`);
  const paymentMethods = [...new Set((input.paymentMethods ?? []).map((m) => String(m).trim().toLowerCase()))];
  if (paymentMethods.length === 0 || !paymentMethods.every(isPaymentMethod)) throw new AdminError("invalid", "Choose at least one payment method: momo or card.");
  const sortOrder = input.sortOrder ?? current?.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < -1000 || sortOrder > 1000) throw new AdminError("invalid", "The order must be a whole number from -1000 to 1000.");
  const vatRateBps = input.vatRateBps ?? current?.vatRateBps ?? 0;
  if (!Number.isInteger(vatRateBps) || vatRateBps < 0 || vatRateBps > MAX_VAT_BPS) throw new AdminError("invalid", "VAT is a percentage from 0 to 100, for example 18.");
  const vatLabel = String(input.vatLabel ?? current?.vatLabel ?? DEFAULT_VAT_LABEL).trim() || DEFAULT_VAT_LABEL;
  if (vatLabel.length > 20) throw new AdminError("invalid", "The tax name is at most 20 characters (for example VAT).");
  return { key, name, currency, countries, paymentMethods: paymentMethods as PaymentMethod[], active: input.active !== false, sortOrder, vatRateBps, vatLabel };
}

/**
 * Pure: the countries of `next` that other regions list, by region. A country belongs to at most one region, live or
 * coming soon, so this is checked against every region.
 */
export function countryClashes(next: Pick<RegionInfo, "key" | "countries">, regions: RegionInfo[]): { region: RegionInfo; countries: string[] }[] {
  return regions.filter((r) => r.key !== next.key).map((r) => ({ region: r, countries: r.countries.filter((c) => next.countries.includes(c)) })).filter((x) => x.countries.length > 0);
}

/**
 * Creates or updates a region (name, status, currency, payment methods, countries, VAT). Rules: a country belongs to
 * one region (with `move`, it leaves the other region, which must keep at least one country); one catch-all (no
 * countries), which stays live; a region companies are billed in cannot be made "coming soon". Audited.
 */
export async function saveRegion(ctx: AdminContext, input: RegionInput): Promise<RegionInfo> {
  const regions = await getRegions({ force: true });
  const askedKey = String(input.key ?? "").trim().toUpperCase() || regionKeyFromName(String(input.name ?? ""));
  const current = regions.find((r) => r.key === askedKey) ?? null;
  if (current && input.isNew) throw new AdminError("conflict", `There is already a region with the key ${current.key} (${current.name}). Give the new one another key.`);
  const next = cleanRegion(input, current);
  if (current && current.countries.length === 0 && next.countries.length > 0) throw new AdminError("conflict", `${current.name} takes every country the live regions do not list, so it has no country list.`);
  if (current && current.countries.length === 0 && !next.active) throw new AdminError("conflict", `${current.name} takes every country the other regions do not list, so it is always live.`);
  if (!current && next.countries.length === 0) throw new AdminError("invalid", "Add at least one country. Every country no live region lists already sees the catch-all region.");
  const otherCatchAll = regions.find((r) => r.key !== next.key && r.countries.length === 0);
  if (next.countries.length === 0 && otherCatchAll) throw new AdminError("conflict", `${otherCatchAll.name} already takes every other country. Give this region a country list.`);
  if (current && current.active && !next.active) {
    const billed = await prisma.business.count({ where: { pricingRegion: current.key } });
    if (billed > 0) throw new AdminError("conflict", `${billed} ${billed === 1 ? "company is" : "companies are"} billed in ${current.name}. Move ${billed === 1 ? "it" : "them"} to another region first (company page, Change region), then make it coming soon.`);
  }
  const clashes = countryClashes(next, regions);
  if (clashes.length > 0 && !input.move) {
    const first = clashes[0];
    throw new AdminError("conflict", `${first.region.name} already lists ${first.countries.join(", ")}. A country belongs to one region: remove it there, or choose "Move here".`);
  }
  const emptied = clashes.find((x) => x.region.countries.length > 0 && x.region.countries.every((c) => x.countries.includes(c)));
  if (emptied) throw new AdminError("conflict", `Moving ${emptied.countries.join(", ")} would leave ${emptied.region.name} with no country. Delete ${emptied.region.name} or give it another country first.`);
  const data = { name: next.name, currency: next.currency, countries: next.countries, paymentMethods: next.paymentMethods, active: next.active, sortOrder: next.sortOrder, vatRateBps: next.vatRateBps, vatLabel: next.vatLabel };
  await prisma.$transaction(async (tx) => {
    for (const { region, countries } of clashes) {
      const left = region.countries.filter((c) => !countries.includes(c));
      await tx.pricingRegion.update({ where: { key: region.key }, data: { countries: left } });
      await writeAudit(tx, ctx, "move_region_countries", `region:${region.key}`, { countries: region.countries }, { countries: left, movedTo: next.key, moved: countries });
    }
    await tx.pricingRegion.upsert({ where: { key: next.key }, create: { key: next.key, ...data }, update: data });
    await writeAudit(tx, ctx, current ? "update_region" : "create_region", `region:${next.key}`, current, next);
  });
  clearRegionCache();
  return next;
}

/**
 * Deletes a region. Refused for the catch-all, for a region companies are billed in, and while a plan is offered only
 * there (it would vanish from every pricing page; give it another region in its plan form first). Its other prices go
 * with it (the plans stay offered elsewhere). Audited with what was deleted.
 */
export async function deleteRegion(ctx: AdminContext, input: { key: string }) {
  const key = String(input.key ?? "").trim().toUpperCase();
  const region = (await getRegions({ force: true })).find((r) => r.key === key);
  if (!region) throw new AdminError("not_found", "No region with that key.");
  if (region.countries.length === 0) throw new AdminError("conflict", `${region.name} takes every other country and cannot be deleted.`);
  const billed = await prisma.business.count({ where: { pricingRegion: key } });
  if (billed > 0) throw new AdminError("conflict", `${billed} ${billed === 1 ? "company is" : "companies are"} billed in ${region.name}. Move ${billed === 1 ? "it" : "them"} to another region first.`);
  const prices = await getRegionPrices({ force: true });
  const here = prices.filter((p) => p.regionKey === key);
  const only = here.filter((p) => !prices.some((o) => o.planKey === p.planKey && o.regionKey !== key));
  if (only.length > 0) {
    const plans = await getPlans({ force: true });
    const names = only.map((p) => plans.find((x) => x.key === p.planKey)?.name ?? p.planKey);
    throw new AdminError("conflict", `${names.join(", ")} ${names.length === 1 ? "is" : "are"} offered only in ${region.name}. Choose another region for ${names.length === 1 ? "it" : "them"} in Plans first.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.planRegionPrice.deleteMany({ where: { regionKey: key } });
    await tx.pricingRegion.delete({ where: { key } });
    await writeAudit(tx, ctx, "delete_region", `region:${key}`, { ...region, prices: here }, null);
  });
  clearRegionCache();
  clearRegionPriceCache();
  return { key, name: region.name };
}

/** Moves a region one place up or down in the list (the order is renumbered 0, 10, 20 ...). Audited. */
export async function moveRegion(ctx: AdminContext, input: { key: string; direction: "up" | "down" }) {
  const regions = await getRegions({ force: true });
  const order = [...regions].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const i = order.findIndex((r) => r.key === String(input.key ?? "").toUpperCase());
  if (i < 0) throw new AdminError("not_found", "No region with that key.");
  const j = input.direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return { key: order[i].key, moved: false };
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  await prisma.$transaction(async (tx) => {
    for (const [n, r] of next.entries()) if (r.sortOrder !== n * 10) await tx.pricingRegion.update({ where: { key: r.key }, data: { sortOrder: n * 10 } });
    await writeAudit(tx, ctx, "reorder_regions", `region:${order[i].key}`, { order: order.map((r) => r.key) }, { order: next.map((r) => r.key) });
  });
  clearRegionCache();
  return { key: order[i].key, moved: true };
}

// ---- which regions a plan is offered in (the plan form) ------------------------------------------------------------

/** One ticked region on the plan form; the catch-all takes no amounts (its price is the plan's own). */
export type PlanRegionChoice = { regionKey: string; monthlyMinor?: number | null; yearlyMinor?: number | null };

type CheckedChoice = { region: RegionInfo; monthlyMinor: number | null; yearlyMinor: number | null };

/**
 * Checks the plan form's regions before anything is saved: at least one; every region exists; a newly ticked region is
 * LIVE (a coming-soon one the plan is already in may stay); a region other than the catch-all has whole amounts in its
 * currency. `planKey` is null for a new plan.
 */
export async function checkPlanRegions(planKey: string | null, choices: PlanRegionChoice[]): Promise<CheckedChoice[]> {
  const regions = await getRegions({ force: true });
  const existing = planKey ? (await getRegionPrices({ force: true })).filter((p) => p.planKey === planKey).map((p) => p.regionKey) : [];
  const seen = new Set<string>();
  const out: CheckedChoice[] = [];
  for (const c of choices) {
    const key = String(c.regionKey ?? "").toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const region = regions.find((r) => r.key === key);
    if (!region) throw new AdminError("not_found", `No region with the key ${key}.`);
    if (!region.active && !existing.includes(key)) throw new AdminError("conflict", `${region.name} is coming soon: plans can be offered there once it is live (Regions).`);
    if (region.countries.length === 0) {
      out.push({ region, monthlyMinor: null, yearlyMinor: null });
      continue;
    }
    for (const [field, value] of [["monthly", c.monthlyMinor], ["yearly", c.yearlyMinor]] as const) {
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_MINOR) throw new AdminError("invalid", `${region.name}: enter the ${field} price before VAT, a whole amount in ${region.currency}${region.currency === "USD" ? " (dollars and cents)" : ""}.`);
    }
    out.push({ region, monthlyMinor: c.monthlyMinor as number, yearlyMinor: c.yearlyMinor as number });
  }
  if (out.length === 0) throw new AdminError("invalid", "Choose at least one region where the plan is shown.");
  return out;
}

/**
 * Sets the regions a plan is offered in, from the plan form: adds, re-prices and removes PlanRegionPrice rows in one
 * transaction with one audit row (update_plan_regions). The catch-all row carries the plan's own price (its amounts are
 * never read; lib/region-prices.ts). A changed regional price forgets its Paddle prices, like setRegionPrice.
 */
export async function setPlanRegions(ctx: AdminContext, planKey: string, choices: PlanRegionChoice[]): Promise<{ changed: boolean; regions: string[] }> {
  const plan = (await getPlans({ force: true })).find((p) => p.key === planKey);
  if (!plan) throw new AdminError("not_found", "No plan with that key.");
  if (plan.isTrial || plan.isCustom) throw new AdminError("conflict", plan.isTrial ? "The free trial is not sold, so it has no regions." : "A custom plan belongs to one company and is never on the pricing page.");
  const checked = await checkPlanRegions(planKey, choices);
  const before = (await getRegionPrices({ force: true })).filter((p) => p.planKey === planKey);
  const settings = await getSettings();
  const rows = checked.map(({ region, monthlyMinor, yearlyMinor }) => {
    const catchAll = region.countries.length === 0;
    const monthly = catchAll ? plan.monthlyPriceCents : (monthlyMinor as number);
    const yearly = catchAll ? plan.yearlyPriceCents : (yearlyMinor as number);
    const currency = catchAll ? plan.currency.toUpperCase() : region.currency;
    const usd = currency === "USD";
    return {
      planKey,
      regionKey: region.key,
      currency,
      monthlyMinor: monthly,
      yearlyMinor: yearly,
      cardMonthlyUsdCents: usd ? monthly : cardUsdCents(monthly, currency, settings.usdToRwf, settings.cardMarginPercent),
      cardYearlyUsdCents: usd ? yearly : cardUsdCents(yearly, currency, settings.usdToRwf, settings.cardMarginPercent),
    };
  });
  const removed = before.filter((b) => !rows.some((r) => r.regionKey === b.regionKey));
  const upserts = rows.filter((r) => {
    const b = before.find((x) => x.regionKey === r.regionKey);
    return !b || b.monthlyMinor !== r.monthlyMinor || b.yearlyMinor !== r.yearlyMinor || b.currency !== r.currency;
  });
  if (removed.length === 0 && upserts.length === 0) return { changed: false, regions: rows.map((r) => r.regionKey) };
  await prisma.$transaction(async (tx) => {
    for (const r of upserts) {
      const b = before.find((x) => x.regionKey === r.regionKey);
      const catchAll = checked.find((c) => c.region.key === r.regionKey)!.region.countries.length === 0;
      await tx.planRegionPrice.upsert({
        where: { planKey_regionKey: { planKey, regionKey: r.regionKey } },
        create: catchAll ? { ...r, paddleMonthlyPriceId: plan.paddleMonthlyPriceId, paddleYearlyPriceId: plan.paddleYearlyPriceId } : r,
        update: { ...r, ...(b && !catchAll ? { paddleMonthlyPriceId: null, paddleYearlyPriceId: null } : {}) },
      });
    }
    if (removed.length > 0) await tx.planRegionPrice.deleteMany({ where: { planKey, regionKey: { in: removed.map((r) => r.regionKey) } } });
    await writeAudit(tx, ctx, "update_plan_regions", `plan:${planKey}`, { regions: before.map(regionAuditOf) }, { regions: rows.map(regionAuditOf) });
  });
  clearRegionPriceCache();
  return { changed: true, regions: rows.map((r) => r.regionKey) };
}

const regionAuditOf = (r: { regionKey: string; currency: string; monthlyMinor: number; yearlyMinor: number }) => ({ regionKey: r.regionKey, currency: r.currency, monthlyMinor: r.monthlyMinor, yearlyMinor: r.yearlyMinor });

export type PlanRegionOption = {
  key: string;
  name: string;
  currency: string;
  status: RegionStatus;
  catchAll: boolean;
  countryCount: number;
  vatRateBps: number;
  vatLabel: string;
  /** This plan's price there (before VAT), when it is offered there. */
  selected: { monthlyMinor: number; yearlyMinor: number } | null;
};

/**
 * Every region for the plan form, in order, with this plan's prices. A new plan (planKey null) starts in the catch-all,
 * as before regions could be chosen; so does a plan with no row at all (the old implicit rule).
 */
export async function planRegionOptions(planKey: string | null): Promise<PlanRegionOption[]> {
  const [regions, prices] = await Promise.all([getRegions({ force: true }), getRegionPrices({ force: true })]);
  const mine = planKey ? prices.filter((p) => p.planKey === planKey) : [];
  return [...regions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => {
      const catchAll = r.countries.length === 0;
      const row = mine.find((p) => p.regionKey === r.key);
      const implicit = catchAll && mine.length === 0;
      return {
        key: r.key,
        name: r.name,
        currency: r.currency,
        status: regionStatus(r),
        catchAll,
        countryCount: r.countries.length,
        vatRateBps: r.vatRateBps ?? 0,
        vatLabel: r.vatLabel ?? DEFAULT_VAT_LABEL,
        selected: row ? { monthlyMinor: row.monthlyMinor, yearlyMinor: row.yearlyMinor } : implicit ? { monthlyMinor: 0, yearlyMinor: 0 } : null,
      };
    });
}

export type RegionPriceInput = { planKey: string; regionKey: string; monthlyMinor: number; yearlyMinor: number };

/** The card price of a local amount with the current settings, for previews and for saving. */
export async function cardPriceFor(minor: number, currency: string): Promise<number> {
  const s = await getSettings();
  return cardUsdCents(minor, currency, s.usdToRwf, s.cardMarginPercent);
}

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
  if (!region.active) throw new AdminError("conflict", `${region.name} is coming soon: companies can be moved there once it is live.`);
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
  const paid = plans.filter((p) => !p.isTrial && !p.isCustom);
  // Companies billed in each region (Business.pricingRegion): a handful of regions, one count each.
  const companies = Object.fromEntries(await Promise.all(regions.map(async (r) => [r.key, await prisma.business.count({ where: { pricingRegion: r.key } }).catch(() => 0)] as const)));
  return {
    settings: { usdToRwf: settings.usdToRwf, cardMarginPercent: settings.cardMarginPercent },
    regions: [...regions].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => {
      const isGlobal = r.countries.length === 0;
      return {
        ...r,
        vatRateBps: r.vatRateBps ?? 0,
        vatLabel: r.vatLabel ?? DEFAULT_VAT_LABEL,
        status: regionStatus(r),
        companies: companies[r.key] ?? 0,
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
