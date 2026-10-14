"use server";

import { refresh } from "next/cache";
import type { ConfirmResult } from "@/components/admin/confirm-button";
import { actionMessage, adminAction, finish } from "@/lib/admin/console";
import { confirmManualPayment, rejectManualPayment } from "@/lib/billing/momo";
import { saveMomoSettings } from "@/lib/billing/momo-settings";
import { reprocessBillingEvent } from "@/lib/billing/paddle-events";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * The decision's outcome in words, for the confirm dialog (components/admin/confirm-button.tsx). On success the page
 * is refreshed in place (next/cache refresh(): the list, the Overview card and the sidebar badges together).
 */
async function decided<T>(message: (result: T) => string, fn: () => Promise<T>): Promise<ConfirmResult> {
  let text: string;
  try {
    text = message(await fn());
  } catch (e) {
    return { ok: false, error: actionMessage(e) };
  }
  refresh();
  return { ok: true, message: text };
}

// Confirm and Reject are the owner's own decision on money that already arrived (or did not), so they run at once:
// no approval queue. adminAction("payments.approve") re-checks the admin (email, verified, AAL2) and the service refuses the API.
// They answer in words instead of redirecting: the dialog closes, the notice shows and the page refreshes in place (the
// list, the Overview card and the sidebar badges together), on Payments and on the Overview alike.

export async function confirmPaymentAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("payments.approve");
  return decided((r) => `Confirmed. The plan is active until ${r.periodEnd.toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" })}${r.emailed ? " and the client has been emailed" : ""}.`, () =>
    confirmManualPayment(ctx, text(f, "id"), new Date(), { transactionId: text(f, "transactionId") || null }),
  );
}

export async function rejectPaymentAction(f: FormData): Promise<ConfirmResult> {
  const ctx = await adminAction("payments.approve");
  return decided((r) => `Rejected. ${r.emailed ? "The client has been told the reason." : "The client sees the reason on their Billing page."}`, () =>
    rejectManualPayment(ctx, text(f, "id"), text(f, "reason")),
  );
}

// The form lives in Admin -> Settings -> Payments: Mobile Money (the owner looks for it there).
export async function savePaymentSettingsAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  await finish("/admin/settings#momo", "Mobile Money details saved.", () =>
    saveMomoSettings(ctx, {
      merchantCode: text(f, "merchantCode"),
      momoNumber: text(f, "momoNumber"),
      accountName: text(f, "accountName"),
      airtelNumber: text(f, "airtelNumber"),
    }),
  );
}

export async function reprocessCardEventAction(f: FormData) {
  const ctx = await adminAction("payments.approve");
  await finish("/admin/payments#card-events", (r) => `Reprocessed ${r.type}.${r.note ? ` Note: ${r.note}.` : ""}`, () => reprocessBillingEvent(ctx, text(f, "id")));
}
