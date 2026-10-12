"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { toMinor } from "@/lib/admin/format";
import { removeRegionPrice, saveRegion, setRegionPrice } from "@/lib/admin/regions-service";
import { AdminError } from "@/lib/admin/types";

const BACK = "/admin/settings/regions";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Each action re-checks the admin (adminAction: allow-listed email, AAL2). Every change is audited.

export async function saveRegionAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, (r) => `${r.name} (${r.key}) saved.`, () =>
    saveRegion(ctx, {
      key: text(f, "key"),
      name: text(f, "name"),
      currency: text(f, "currency"),
      countries: text(f, "countries").split(/[\s,]+/).filter(Boolean),
      paymentMethods: f.getAll("paymentMethods").map(String),
      active: f.get("active") === "on",
      sortOrder: Number(text(f, "sortOrder") || 0),
    }),
  );
}

export async function setRegionPriceAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, (r) => `${r.planKey} in ${r.regionKey}: saved.`, () => {
    const currency = text(f, "currency").toUpperCase();
    const monthly = toMinor(text(f, "monthly"), currency);
    const yearly = toMinor(text(f, "yearly"), currency);
    if (monthly === null || yearly === null) throw new AdminError("invalid", `Enter the prices as amounts in ${currency}, for example 15000.`);
    return setRegionPrice(ctx, { planKey: text(f, "planKey"), regionKey: text(f, "regionKey"), monthlyMinor: monthly, yearlyMinor: yearly });
  });
}

export async function removeRegionPriceAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, (r) => `${r.planKey} is no longer offered in ${r.regionKey}.`, () => removeRegionPrice(ctx, { planKey: text(f, "planKey"), regionKey: text(f, "regionKey") }));
}
