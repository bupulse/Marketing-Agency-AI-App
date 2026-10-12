"use server";

import { addAvailability, removeAvailability } from "@/lib/admin/availability";
import { adminAction, finish } from "@/lib/admin/console";
import { recomputeCardPrices } from "@/lib/admin/regions-service";
import { setSetting, type SettingName } from "@/lib/admin/settings";

const BACK = "/admin/settings";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const NAMES: SettingName[] = ["trialDays", "usdToRwf", "cardMarginPercent", "meetingLink", "organizerEmail", "slotMinutes", "bufferMinutes", "blockedDates"];

// Each action re-checks the admin (adminAction: allow-listed email, AAL2). Every saved setting is audited.

/** Saves whichever settings the form carries (one form per panel). */
export async function saveSettingsAction(f: FormData) {
  const ctx = await adminAction();
  await finish(BACK, "Settings saved.", async () => {
    for (const name of NAMES) if (f.has(name)) await setSetting(ctx, name, text(f, name));
  });
}

export async function recomputeCardPricesAction() {
  const ctx = await adminAction();
  await finish(BACK, (r) => (r.changed === 0 ? "Card prices were already up to date." : `${r.changed} card ${r.changed === 1 ? "price" : "prices"} recomputed. Creating them in Paddle is still to do (docs/REGIONS.md).`), () => recomputeCardPrices(ctx));
}

export async function addAvailabilityAction(f: FormData) {
  const ctx = await adminAction();
  await finish(`${BACK}#availability`, "Window added.", () => addAvailability(ctx, { weekday: Number(text(f, "weekday")), start: text(f, "start"), end: text(f, "end") }));
}

export async function removeAvailabilityAction(f: FormData) {
  const ctx = await adminAction();
  await finish(`${BACK}#availability`, "Window removed.", () => removeAvailability(ctx, text(f, "id")));
}
