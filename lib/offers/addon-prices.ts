import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { getRegion, getRegions } from "@/lib/region";
import { addonOf, MAX_OFFER_MINOR, type AddonPriceRow } from "./shared";

// Add-on prices per region (Admin -> Add-on prices, docs/OFFERS.md). Every change is audited with the old and new
// amount. The list of add-ons is code (ADDONS); a row exists only for the add-ons priced in a region.

export async function listAddonPrices(regionKey?: string): Promise<AddonPriceRow[]> {
  const rows = await prisma.addonPrice.findMany({ where: regionKey ? { regionKey } : undefined, orderBy: [{ regionKey: "asc" }, { addonKey: "asc" }] });
  return rows.map((r) => ({ addonKey: r.addonKey, regionKey: r.regionKey, currency: r.currency.toUpperCase(), monthlyMinor: r.monthlyMinor }));
}

/**
 * Sets (or, with `monthlyMinor: null`, removes) one add-on's monthly price in a region. The currency is always the
 * region's: an offer is priced in the company's region currency only. Console only (not a Jarvis tool). Audited.
 */
export async function setAddonPrice(ctx: AdminContext, input: { addonKey: string; regionKey: string; monthlyMinor: number | null }) {
  if (ctx.viaApi) throw new AdminError("forbidden", "Add-on prices are edited in the admin console.");
  const addon = addonOf(input.addonKey);
  if (!addon) throw new AdminError("invalid", "That is not an add-on.");
  const region = await getRegion(input.regionKey);
  if (!region) throw new AdminError("not_found", "No region with that key.");
  if (input.monthlyMinor !== null && (!Number.isInteger(input.monthlyMinor) || input.monthlyMinor < 0 || input.monthlyMinor > MAX_OFFER_MINOR)) {
    throw new AdminError("invalid", "The price is a whole amount of zero or more.");
  }
  const where = { addonKey_regionKey: { addonKey: addon.key, regionKey: region.key } };
  const before = await prisma.addonPrice.findUnique({ where });
  const currency = region.currency.toUpperCase();
  if (input.monthlyMinor === null) {
    if (!before) return { addonKey: addon.key, regionKey: region.key, monthlyMinor: null };
    await prisma.$transaction(async (tx) => {
      await tx.addonPrice.deleteMany({ where: { addonKey: addon.key, regionKey: region.key } });
      await writeAudit(tx, ctx, "remove_addon_price", `addon:${region.key}:${addon.key}`, { monthlyMinor: before.monthlyMinor, currency: before.currency }, null);
    });
    return { addonKey: addon.key, regionKey: region.key, monthlyMinor: null };
  }
  if (before && before.monthlyMinor === input.monthlyMinor && before.currency.toUpperCase() === currency) return { addonKey: addon.key, regionKey: region.key, monthlyMinor: input.monthlyMinor };
  await prisma.$transaction(async (tx) => {
    await tx.addonPrice.upsert({
      where,
      create: { addonKey: addon.key, regionKey: region.key, currency, monthlyMinor: input.monthlyMinor as number, updatedBy: ctx.actor },
      update: { currency, monthlyMinor: input.monthlyMinor as number, updatedBy: ctx.actor },
    });
    await writeAudit(tx, ctx, "set_addon_price", `addon:${region.key}:${addon.key}`, before ? { monthlyMinor: before.monthlyMinor, currency: before.currency } : null, { monthlyMinor: input.monthlyMinor, currency });
  });
  return { addonKey: addon.key, regionKey: region.key, monthlyMinor: input.monthlyMinor };
}

/** Every active region with its add-on prices, for the admin page. */
export async function addonPriceTable() {
  const [regions, prices] = await Promise.all([getRegions({ force: true }), listAddonPrices()]);
  return regions.filter((r) => r.active).map((r) => ({ region: r, prices: prices.filter((p) => p.regionKey === r.key) }));
}
