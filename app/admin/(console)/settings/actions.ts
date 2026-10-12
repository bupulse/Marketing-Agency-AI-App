"use server";

import { addAvailability, removeAvailability } from "@/lib/admin/availability";
import { adminAction, finish } from "@/lib/admin/console";
import { recomputeCardPrices } from "@/lib/admin/regions-service";
import { setSetting, type SettingName } from "@/lib/admin/settings";
import { disconnectGoogleCalendar, setGoogleCalendarId, testGoogleCalendar } from "@/lib/google-calendar/calendar";

const BACK = "/admin/settings";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const NAMES: SettingName[] = ["trialDays", "usdToRwf", "cardMarginPercent", "meetingLink", "organizerEmail", "slotMinutes", "bufferMinutes", "blockedDates", "demoDailyCap"];

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

// ---- Google Calendar (connecting is a link to /api/admin/google-calendar/connect, which checks AAL2 itself) ----------

const GOOGLE = `${BACK}#google-calendar`;

export async function testGoogleCalendarAction() {
  await adminAction(); // read-only, so nothing to audit; the admin gate (AAL2) still runs first
  await finish(GOOGLE, (r) => `Google Calendar works: ${r.email ?? "the connected account"}, calendar "${r.calendarId}", ${r.busy} busy ${r.busy === 1 ? "time" : "times"} in the next 14 days.`, () => testGoogleCalendar());
}

export async function googleCalendarIdAction(f: FormData) {
  const ctx = await adminAction();
  await finish(GOOGLE, (r) => (r.changed ? `Demo events now go to calendar "${r.calendarId}".` : "That calendar was already chosen."), () => setGoogleCalendarId(ctx, text(f, "calendarId")));
}

export async function disconnectGoogleCalendarAction() {
  const ctx = await adminAction();
  await finish(GOOGLE, (r) => `Google Calendar disconnected${r.email ? ` (${r.email})` : ""}.${r.revoked ? "" : " Google did not confirm the revoke: remove BuPulse under your Google account's third-party access."} New bookings use the meeting link and .ics invites.`, () => disconnectGoogleCalendar(ctx));
}
