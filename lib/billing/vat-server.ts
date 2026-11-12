import "server-only";
import { prisma } from "@/lib/db";
import { cleanVatSettings, DEFAULT_VAT_SETTINGS, VAT_SETTING_KEYS, type VatSettings } from "./vat";

// The VAT settings (Admin -> Settings -> VAT), read on every page that shows an RWF price, so they are cached briefly
// per isolate like the plan catalog. Saving a setting clears this cache (app/admin/(console)/(system)/settings/actions.ts).
// The rules themselves are in lib/billing/vat.ts.

const TTL_MS = 30_000;
let cached: { at: number; value: VatSettings } | null = null;

export function clearVatSettingsCache() {
  cached = null;
}

/** The VAT settings: on, 18% and no TIN until the owner changes them. A database blip keeps the last copy (or the defaults). */
export async function getVatSettings(): Promise<VatSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const rows = await prisma.adminSetting.findMany({ where: { key: { in: Object.values(VAT_SETTING_KEYS) } } });
    const by = new Map(rows.map((r) => [r.key, r.value as unknown]));
    cached = { at: Date.now(), value: cleanVatSettings({ enabled: by.get(VAT_SETTING_KEYS.enabled), ratePercent: by.get(VAT_SETTING_KEYS.ratePercent), tin: by.get(VAT_SETTING_KEYS.tin) }) };
  } catch {
    cached = { at: Date.now(), value: cached?.value ?? DEFAULT_VAT_SETTINGS };
  }
  return cached.value;
}
