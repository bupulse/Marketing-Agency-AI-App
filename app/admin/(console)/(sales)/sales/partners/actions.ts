"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { approvePartner, recordPartnerPayout, rejectPartner, setPartnerPaused } from "@/lib/partners/service";

// adminAction re-checks the person and the permission: server actions are public POST endpoints. Every change and its
// audit row are one transaction (lib/partners/service.ts). Nothing here contacts the partner: the owner sends the link.

const BACK = "/admin/sales/partners";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function approvePartnerAction(f: FormData) {
  const ctx = await adminAction("sales.team");
  await finish(BACK, (r) => `Partner approved. Code ${r.refCode}. Send them their link and their page from the row below.`, () => approvePartner(ctx, text(f, "id")));
}

export async function rejectPartnerAction(f: FormData) {
  const ctx = await adminAction("sales.team");
  await finish(BACK, "Application turned down. Only you see the reason.", () => rejectPartner(ctx, text(f, "id"), text(f, "reason")));
}

export async function pausePartnerAction(f: FormData) {
  const ctx = await adminAction("sales.team");
  const paused = text(f, "paused") === "1";
  await finish(BACK, paused ? "Partner paused: their link no longer counts new sign-ups." : "Partner active again.", () => setPartnerPaused(ctx, text(f, "id"), paused));
}

// A money action: the same permission as confirming Mobile Money payments.
export async function recordPayoutAction(f: FormData) {
  const ctx = await adminAction("payments.approve");
  const amount = Number(text(f, "amount").replace(/[\s,]/g, ""));
  await finish(BACK, (r) => `Payout of ${r.amountRwf.toLocaleString("en-US")} RWF recorded (${r.reference}).`, () =>
    recordPartnerPayout(ctx, { partnerId: text(f, "id"), amountRwf: amount, reference: text(f, "reference"), note: text(f, "note") || null }),
  );
}
