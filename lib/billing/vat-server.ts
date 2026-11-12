import "server-only";
import { prisma } from "@/lib/db";
import { getRegions } from "@/lib/region";
import { cleanVatTin, DEFAULT_VAT_SETTINGS, VAT_SETTING_KEYS, vatRatesFromRegions, type VatSettings } from "./vat";

// The VAT the server works with: the rate of each currency from the pricing regions (PricingRegion.vatRateBps, edited in
// Admin -> Money -> Regions; the regions are cached 30 s by lib/region.ts) and BuPulse's TIN (Admin -> Settings -> VAT,
// an AdminSetting row cached here as briefly). Saving the TIN clears this cache (settings/actions.ts); saving a region
// clears the region cache. The rules themselves are in lib/billing/vat.ts.

const TTL_MS = 30_000;
let cachedTin: { at: number; value: string } | null = null;

export function clearVatSettingsCache() {
  cachedTin = null;
}

async function getVatTin(): Promise<string> {
  if (cachedTin && Date.now() - cachedTin.at < TTL_MS) return cachedTin.value;
  try {
    const row = await prisma.adminSetting.findUnique({ where: { key: VAT_SETTING_KEYS.tin } });
    cachedTin = { at: Date.now(), value: cleanVatTin(row?.value) };
  } catch {
    cachedTin = { at: Date.now(), value: cachedTin?.value ?? DEFAULT_VAT_SETTINGS.tin };
  }
  return cachedTin.value;
}

/** The VAT rates by currency (from the regions: RWF 18% for Rwanda) and the TIN. A database blip keeps the last copy. */
export async function getVatSettings(): Promise<VatSettings> {
  const [regions, tin] = await Promise.all([getRegions(), getVatTin()]);
  return { rates: vatRatesFromRegions(regions), tin };
}
