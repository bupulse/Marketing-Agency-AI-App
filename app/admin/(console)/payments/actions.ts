"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { AdminError } from "@/lib/admin/types";
import { confirmManualPayment, rejectManualPayment } from "@/lib/billing/momo";
import { saveMomoSettings } from "@/lib/billing/momo-settings";
import { getSellablePlans } from "@/lib/plan-catalog";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Confirm and Reject are the owner's own decision on money that already arrived (or did not), so they run at once:
// no approval queue. adminAction() re-checks the admin (email, verified, AAL2) and the service refuses the API.

export async function confirmPaymentAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/payments", (r) => `Confirmed. The plan is active until ${r.periodEnd.toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" })}${r.emailed ? " and the client has been emailed" : ""}.`, () =>
    confirmManualPayment(ctx, text(f, "id")),
  );
}

export async function rejectPaymentAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/payments", (r) => `Rejected. ${r.emailed ? "The client has been told the reason." : "The client sees the reason on their Billing page."}`, () =>
    rejectManualPayment(ctx, text(f, "id"), text(f, "reason")),
  );
}

/** Whole francs typed by the owner ("15,000" or "15000"), or null when empty; anything else is refused. */
function francs(raw: string): number | null {
  const clean = raw.replace(/[\s,]/g, "");
  if (clean === "") return null;
  if (!/^\d+$/.test(clean)) throw new AdminError("invalid", "Prices are whole francs, for example 15000.");
  return Number(clean);
}

export async function savePaymentSettingsAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/payments#settings", "Payment details saved.", async () => {
    const rate = text(f, "usdToRwf").replace(/[\s,]/g, "");
    const prices: Record<string, { monthlyMinor: number; yearlyMinor: number } | null> = {};
    for (const plan of await getSellablePlans()) {
      const monthly = francs(text(f, `monthly_${plan.key}`));
      const yearly = francs(text(f, `yearly_${plan.key}`));
      // Both empty: back to the converted USD price. One empty: refuse, so a plan never sells at half a price.
      if (monthly === null && yearly === null) prices[plan.key] = null;
      else if (monthly === null || yearly === null) throw new AdminError("invalid", `${plan.name}: give both the monthly and the yearly price, or leave both empty.`);
      else prices[plan.key] = { monthlyMinor: monthly, yearlyMinor: yearly };
    }
    return saveMomoSettings(ctx, {
      merchantCode: text(f, "merchantCode"),
      momoNumber: text(f, "momoNumber"),
      accountName: text(f, "accountName"),
      airtelNumber: text(f, "airtelNumber"),
      usdToRwf: rate === "" ? undefined : Number(rate),
      prices,
    });
  });
}
