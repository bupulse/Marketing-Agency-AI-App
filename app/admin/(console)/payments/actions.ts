"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { confirmManualPayment, rejectManualPayment } from "@/lib/billing/momo";
import { saveMomoSettings } from "@/lib/billing/momo-settings";

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

export async function savePaymentSettingsAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/payments#settings", "Payment details saved.", () =>
    saveMomoSettings(ctx, {
      merchantCode: text(f, "merchantCode"),
      momoNumber: text(f, "momoNumber"),
      accountName: text(f, "accountName"),
      airtelNumber: text(f, "airtelNumber"),
    }),
  );
}
