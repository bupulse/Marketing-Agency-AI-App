"use server";

import { addAvailability, removeAvailability } from "@/lib/admin/availability";
import { actionMessage, adminAction, finish } from "@/lib/admin/console";
import { recomputeCardPrices } from "@/lib/admin/regions-service";
import { setSetting, type SettingName } from "@/lib/admin/settings";
import { refreshEurRate } from "@/lib/money/display-server";
import { disconnectGoogleCalendar, setGoogleCalendarId, testGoogleCalendar } from "@/lib/google-calendar/calendar";
import { AdminError } from "@/lib/admin/types";
import { clearPaddleSettings, savePaddleSettings, SECRET_LABEL } from "@/lib/billing/paddle-config";
import { setUpPaddleStep, testPaddleConnection, type SetUpStep, type StepResult } from "@/lib/billing/paddle-setup";

const BACK = "/admin/settings";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const NAMES: SettingName[] = ["trialDays", "usdToRwf", "cardMarginPercent", "meetingLink", "organizerEmail", "slotMinutes", "bufferMinutes", "blockedDates", "demoDailyCap", "pageLoader", "displayCurrency", "usdToEur"];

// Each action re-checks the admin (adminAction: allow-listed email, AAL2). Every saved setting is audited.

/** Saves whichever settings the form carries (one form per panel). */
export async function saveSettingsAction(f: FormData) {
  const ctx = await adminAction("system");
  await finish(BACK, "Settings saved.", async () => {
    for (const name of NAMES) if (f.has(name)) await setSetting(ctx, name, text(f, name));
    // A checkbox is absent when unticked: the currency panel says it carries the switch.
    if (f.has("currencyPanel")) await setSetting(ctx, "eurRateAuto", f.get("eurRateAuto") === "on");
  });
}

/** "Refresh now": fetches the day's ECB EUR rate (api.frankfurter.app) even when the daily refresh is off. */
export async function refreshEurRateAction() {
  await adminAction("system");
  await finish(`${BACK}#currency`, (r) => (r.ok ? `EUR rate refreshed: 1 USD = ${r.rate} EUR (ECB).` : "The ECB rate could not be fetched; the stored rate stays in use."), () => refreshEurRate({ force: true }));
}

export async function recomputeCardPricesAction() {
  const ctx = await adminAction("plans.manage");
  await finish(BACK, (r) => (r.changed === 0 ? "Card prices were already up to date." : `${r.changed} card ${r.changed === 1 ? "price" : "prices"} recomputed. Creating them in Paddle is still to do (docs/REGIONS.md).`), () => recomputeCardPrices(ctx));
}

export async function addAvailabilityAction(f: FormData) {
  const ctx = await adminAction(["system", "demos"]);
  await finish(`${BACK}#availability`, "Window added.", () => addAvailability(ctx, { weekday: Number(text(f, "weekday")), start: text(f, "start"), end: text(f, "end") }));
}

export async function removeAvailabilityAction(f: FormData) {
  const ctx = await adminAction(["system", "demos"]);
  await finish(`${BACK}#availability`, "Window removed.", () => removeAvailability(ctx, text(f, "id")));
}

// ---- Google Calendar (connecting is a link to /api/admin/google-calendar/connect, which checks AAL2 itself) ----------

const GOOGLE = `${BACK}#google-calendar`;

export async function testGoogleCalendarAction() {
  await adminAction(["system", "demos"]); // read-only, so nothing to audit; the admin gate (AAL2) still runs first
  await finish(GOOGLE, (r) => `Google Calendar works: ${r.email ?? "the connected account"}, calendar "${r.calendarId}", ${r.busy} busy ${r.busy === 1 ? "time" : "times"} in the next 14 days.`, () => testGoogleCalendar());
}

export async function googleCalendarIdAction(f: FormData) {
  const ctx = await adminAction(["system", "demos"]);
  await finish(GOOGLE, (r) => (r.changed ? `Demo events now go to calendar "${r.calendarId}".` : "That calendar was already chosen."), () => setGoogleCalendarId(ctx, text(f, "calendarId")));
}

export async function disconnectGoogleCalendarAction() {
  const ctx = await adminAction(["system", "demos"]);
  await finish(GOOGLE, (r) => `Google Calendar disconnected${r.email ? ` (${r.email})` : ""}.${r.revoked ? "" : " Google did not confirm the revoke: remove BuPulse under your Google account's third-party access."} New bookings use the meeting link and .ics invites.`, () => disconnectGoogleCalendar(ctx));
}

// ---- Card payments (Paddle); the Mobile Money form uses savePaymentSettingsAction (../payments/actions.ts) ---------------------------------------------

const PADDLE = `${BACK}#paddle`;

/** Saves the environment and any secret typed (an empty field keeps the saved one). Values are never sent back. */
export async function savePaddleSettingsAction(f: FormData) {
  const ctx = await adminAction("system");
  await finish(PADDLE, (r) => (r.changed.length ? `Paddle ${r.environment === "production" ? "live" : "sandbox"} saved (${r.changed.map((n) => SECRET_LABEL[n].toLowerCase()).join(", ")}).` : "Nothing changed."), () =>
    savePaddleSettings(ctx, { environment: text(f, "environment"), apiKey: text(f, "apiKey"), clientToken: text(f, "clientToken"), webhookSecret: text(f, "webhookSecret") }),
  );
}

/** Read-only: the API key typed in the form (with its environment), else the saved one. */
export async function testPaddleAction(f: FormData) {
  await adminAction("system"); // read-only, nothing to audit; the admin gate (AAL2) still runs first
  await finish(PADDLE, (r) => r.message, async () => {
    const r = await testPaddleConnection({ apiKey: text(f, "apiKey") || undefined, environment: text(f, "environment") === "production" ? "production" : "sandbox" });
    if (!r.ok) throw new AdminError("unavailable", r.message);
    return r;
  });
}

export async function clearPaddleSettingsAction() {
  const ctx = await adminAction("system");
  await finish(PADDLE, "Saved Paddle values removed. The environment variables apply again, if any are set.", () => clearPaddleSettings(ctx));
}

/**
 * One step of "Set up prices" (the page calls the steps in order, repeating one while it says `more`), so each request
 * stays within the hosting time limit. Returns the result instead of redirecting.
 */
export async function paddleSetUpStepAction(step: string, attempted: string[] = []): Promise<{ ok: true; result: StepResult } | { ok: false; error: string }> {
  const ctx = await adminAction("system");
  try {
    const keys = Array.isArray(attempted) ? attempted.filter((k) => typeof k === "string" && k.length <= 64).slice(0, 200) : [];
    return { ok: true, result: await setUpPaddleStep(ctx, step as SetUpStep, keys) };
  } catch (error) {
    return { ok: false, error: actionMessage(error) };
  }
}
