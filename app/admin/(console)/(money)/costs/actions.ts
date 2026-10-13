"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { AdminError } from "@/lib/admin/types";
import { deleteProviderBill, deleteRecurringCost, endRecurringCost, saveProviderBill, saveRecurringCost } from "@/lib/money/costs";

// adminAction() re-checks the admin (email, verified, AAL2): server actions are public POST endpoints. Every write is
// audited in lib/money/costs.ts.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function amountOf(f: FormData): number {
  const n = Number(text(f, "amount").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new AdminError("invalid", "Enter the amount, for example 5.00 (USD) or 7250 (RWF).");
  return n;
}

export async function saveRecurringCostAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/costs#recurring", "Recurring cost saved.", () =>
    saveRecurringCost(ctx, {
      id: text(f, "id") || undefined,
      name: text(f, "name"),
      provider: text(f, "provider") || "other",
      category: text(f, "category") as never,
      amount: amountOf(f),
      currency: text(f, "currency") as never,
      period: text(f, "period") as never,
      startMonth: text(f, "startMonth"),
      endMonth: text(f, "endMonth") || null,
      note: text(f, "note") || undefined,
    }),
  );
}

export async function endRecurringCostAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/costs#recurring", "Recurring cost stopped. Earlier months still count it.", () => endRecurringCost(ctx, text(f, "id"), text(f, "lastMonth")));
}

export async function deleteRecurringCostAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/costs#recurring", "Recurring cost deleted from every month.", () => deleteRecurringCost(ctx, text(f, "id")));
}

export async function saveProviderBillAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/costs#bills", "Bill saved. It replaces the estimate for that provider and month.", () =>
    saveProviderBill(ctx, { provider: text(f, "provider"), month: text(f, "month"), amount: amountOf(f), currency: text(f, "currency") as never, note: text(f, "note") || undefined }),
  );
}

export async function deleteProviderBillAction(f: FormData) {
  const ctx = await adminAction();
  await finish("/admin/costs#bills", "Bill deleted. The estimate counts again for that month.", () => deleteProviderBill(ctx, text(f, "id")));
}
