"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { toMinor } from "@/lib/admin/format";
import { deleteRegion, moveRegion, regionKeyFromName, removeRegionPrice, saveRegion, setRegionPrice } from "@/lib/admin/regions-service";
import { AdminError } from "@/lib/admin/types";
import { parseVatPercent } from "@/lib/vat";

const BACK = "/admin/settings/regions";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const editorOf = (key: string) => `${BACK}/${encodeURIComponent(key)}`;

// Each action re-checks the admin (adminAction: allow-listed email, AAL2, plans.manage like Plans). Every change is audited.

/** Create or edit a region: name, status (Live / Coming soon), currency, payment methods, countries, VAT. */
export async function saveRegionAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  const isNew = text(f, "isNew") === "1";
  const key = (text(f, "key") || regionKeyFromName(text(f, "name"))).toUpperCase();
  const vat = parseVatPercent(text(f, "vatPercent"));
  let saved: Awaited<ReturnType<typeof saveRegion>> | null = null;
  let failure: unknown = null;
  try {
    if (vat === null) throw new AdminError("invalid", "VAT is a percentage from 0 to 100, for example 18 (or 0 for none).");
    saved = await saveRegion(ctx, {
      key,
      name: text(f, "name"),
      currency: text(f, "currency"),
      countries: f.getAll("countries").map(String).flatMap((v) => v.split(/[\s,]+/)).filter(Boolean),
      paymentMethods: f.getAll("paymentMethods").map(String),
      active: text(f, "status") ? text(f, "status") === "LIVE" : f.get("active") === "on",
      ...(text(f, "sortOrder") ? { sortOrder: Number(text(f, "sortOrder")) } : {}),
      vatRateBps: vat,
      vatLabel: text(f, "vatLabel") || undefined,
      move: text(f, "move") === "1",
      isNew,
    });
  } catch (e) {
    failure = e;
  }
  // A saved region opens in its editor; a new one that failed goes back to the new-region page.
  if (!saved) {
    await finish(isNew ? `${BACK}/new` : editorOf(key), "", async () => {
      throw failure;
    });
    return;
  }
  const done = saved;
  await finish(editorOf(done.key), `${done.name} ${isNew ? "created" : "saved"}.`, async () => done);
}

/** Deletes a region (the service refuses the catch-all, a region companies are billed in, and a plan's only region). */
export async function deleteRegionAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  const key = text(f, "key");
  let failure: unknown = null;
  try {
    await deleteRegion(ctx, { key });
  } catch (e) {
    failure = e;
  }
  if (failure) {
    await finish(editorOf(key), "", async () => {
      throw failure;
    });
    return;
  }
  await finish(BACK, `Region ${key} deleted.`, async () => null);
}

export async function moveRegionAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  const direction = text(f, "direction") === "down" ? "down" : "up";
  await finish(BACK, "Order saved.", () => moveRegion(ctx, { key: text(f, "key"), direction }));
}

export async function setRegionPriceAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  await finish(editorOf(text(f, "regionKey")), (r) => `${r.planKey} in ${r.regionKey}: saved.`, () => {
    const currency = text(f, "currency").toUpperCase();
    const monthly = toMinor(text(f, "monthly"), currency);
    const yearly = toMinor(text(f, "yearly"), currency);
    if (monthly === null || yearly === null) throw new AdminError("invalid", `Enter the prices as amounts in ${currency}, for example 15000.`);
    return setRegionPrice(ctx, { planKey: text(f, "planKey"), regionKey: text(f, "regionKey"), monthlyMinor: monthly, yearlyMinor: yearly });
  });
}

export async function removeRegionPriceAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  await finish(editorOf(text(f, "regionKey")), (r) => `${r.planKey} is no longer offered in ${r.regionKey}.`, () => removeRegionPrice(ctx, { planKey: text(f, "planKey"), regionKey: text(f, "regionKey") }));
}
