"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { AdminError } from "@/lib/admin/types";
import { setAddonPrice } from "@/lib/offers/addon-prices";
import { ADDONS } from "@/lib/offers/shared";
import { parseMoney } from "@/lib/invoices/shared";
import { getRegion } from "@/lib/region";

// adminAction("plans.manage") re-checks the admin (email, verified, AAL2): server actions are public POST endpoints. Each changed
// price is its own audited write (lib/offers/addon-prices.ts).

/** Saves one region's column: every add-on field; an empty field removes that add-on's price in the region. */
export async function saveAddonPricesAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  const regionKey = String(f.get("regionKey") ?? "");
  await finish(`/admin/addon-prices#region-${regionKey}`, (n) => (n === 0 ? "Nothing changed." : `${n} ${n === 1 ? "price" : "prices"} saved.`), async () => {
    const region = await getRegion(regionKey);
    if (!region) throw new AdminError("not_found", "No region with that key.");
    let changed = 0;
    for (const addon of ADDONS) {
      const raw = String(f.get(`price_${addon.key}`) ?? "").trim();
      const before = String(f.get(`before_${addon.key}`) ?? "").trim();
      if (raw === before) continue;
      const minor = raw === "" ? null : parseMoney(raw, region.currency);
      if (raw !== "" && minor === null) throw new AdminError("invalid", `${addon.label}: type an amount like ${region.currency === "RWF" ? "5000" : "12.00"}.`);
      await setAddonPrice(ctx, { addonKey: addon.key, regionKey: region.key, monthlyMinor: minor });
      changed++;
    }
    return changed;
  });
}
