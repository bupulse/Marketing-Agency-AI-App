import "server-only";
import { adminEmails } from "@/lib/admin/auth";
import { isServiceEnabled } from "@/lib/admin/switch";
import { logError } from "@/lib/errors";
import { runInBackground } from "@/lib/leads/background";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { alertFields, alertIntro, alertSubject, telegramButtons, telegramText, type LeadAlert } from "./format";
import { sendTelegramMessage } from "./telegram";
import { readTelegramChat, resolveTelegramToken } from "./telegram-settings";

// Instant alerts to the owner about a new lead (a quote request, a contact form, a help chat on the marketing site, a
// chat waiting for a person), on every channel that is set up: email to the admin addresses (free, always on) and
// Telegram (free, once connected in Admin -> Settings). A channel is one entry in ALERT_CHANNELS, so a later one (a
// phone call through Bland AI or Twilio, which cost money per call) is added there and no caller changes. Alerts run
// after the response (runInBackground: the host's waitUntil; under `next start` on the self-hosted PC a promise that
// keeps running in the server process), never slow the form, and a failing channel is logged, never thrown.
// Nothing is skipped quietly: a channel that is on but not set up (no bot token, no connected chat, no admin address)
// writes a warning to Admin -> Errors (once a day per server, not on every alert: Admin -> Health keeps listing what is
// missing until it is fixed, setup.ts), and an alert that reached nobody writes an error.

export type ChannelOutcome = "sent" | "skipped";

export type AlertChannel = {
  id: string;
  /** Sends the alert, or says it was skipped (not set up). Throws on a real failure, which is logged. */
  send: (alert: LeadAlert) => Promise<ChannelOutcome>;
};

/** The same "not set up" warning is written at most once in this long per server process. */
export const SETUP_WARNING_EVERY_MS = 24 * 3_600_000;
const warnedAt = new Map<string, number>();

/** Tests: forget which warnings were written. */
export function resetSetupWarnings() {
  warnedAt.clear();
}

/**
 * A channel that is switched on but cannot send: written to Admin -> Errors as a warning, once a day per reason (a
 * missing bot token used to write one warning per quote request and per chat). Never thrown.
 */
async function notSetUp(channel: string, alert: LeadAlert, why: string, now = Date.now()): Promise<"skipped"> {
  const key = `${channel}:${why}`;
  const last = warnedAt.get(key);
  if (last === undefined || now - last >= SETUP_WARNING_EVERY_MS) {
    warnedAt.set(key, now);
    await logError(new Error(`${alert.kind} alert not sent by ${channel}: ${why} (written once a day; Admin -> Health lists it until it is set up)`), { source: `lead-alerts.${channel}`, level: "warn", kind: alert.kind });
  }
  return "skipped";
}

/** Chats open in the support app; everything else is a call-first lead. */
const chatAlert = (alert: LeadAlert) => alert.kind === "support_chat" || alert.kind === "support_waiting";

export const emailChannel: AlertChannel = {
  id: "email",
  async send(alert) {
    // Switched off in Admin -> Services on purpose: quiet. The switch check also loads the keys saved there.
    if (!(await isServiceEnabled("resend"))) return "skipped";
    const to = adminEmails();
    if (!to.length) return notSetUp("email", alert, "ADMIN_EMAILS is empty.");
    if (!process.env.RESEND_API_KEY) return notSetUp("email", alert, "RESEND_API_KEY is not set.");
    const fields = alertFields(alert);
    const phone = fields.find((f) => f.label === "Phone");
    const whatsapp = fields.find((f) => f.label === "WhatsApp");
    const open = alert.openUrl ? { label: chatAlert(alert) ? "Open the chat" : "Open", url: alert.openUrl } : undefined;
    const call = phone?.href ? { label: `Call ${alert.name.split(/\s+/)[0] || "now"}`, url: phone.href } : undefined;
    const email = renderEmail({
      heading: alertSubject(alert),
      intro: alertIntro(alert),
      // The two links are buttons; every other detail is a block (the email layout escapes them).
      blocks: fields.filter((f) => f.label !== "WhatsApp").map((f) => ({ label: f.label, value: f.value })),
      // A chat is answered in the chat; a quote or form is answered with a call.
      button: chatAlert(alert) ? (open ?? call) : (call ?? open),
      secondButton: whatsapp?.href ? { label: "WhatsApp", url: whatsapp.href, color: "#1f9d55" } : undefined,
      footer: alert.openUrl ? `Open it in BuPulse: ${alert.openUrl}` : undefined,
    });
    let sent = 0;
    for (const address of to) if (await sendEmail({ to: address, subject: alertSubject(alert), html: email.html, text: email.text })) sent++;
    if (sent === 0) throw new Error(`no lead alert email was sent (${to.length} admin ${to.length === 1 ? "address" : "addresses"}; see the Resend card in Admin -> Services)`);
    return "sent";
  },
};

export const telegramChannel: AlertChannel = {
  id: "telegram",
  async send(alert) {
    // Switched off in Admin -> Services on purpose: quiet.
    if (!(await isServiceEnabled("telegram"))) return "skipped";
    // The token saved in Admin -> Services, else the environment's (resolveTelegramToken), like every other key.
    const token = await resolveTelegramToken();
    const chat = await readTelegramChat();
    const r = await sendTelegramMessage({ token, chatId: chat?.chatId, text: telegramText(alert), buttons: telegramButtons(alert, publicSiteUrl()) });
    if (r.ok) return "sent";
    // No token, or no chat connected: say so (Admin -> Services, Telegram card; Admin -> Settings, Lead alerts).
    if (r.skipped) return notSetUp("telegram", alert, r.error);
    throw new Error(r.error);
  },
};

/** Every channel, in the order they go out. Add a phone-call channel here later. */
export const ALERT_CHANNELS: readonly AlertChannel[] = [emailChannel, telegramChannel];

/**
 * Sends `alert` on every channel at once. Never throws; a failed channel is written to Admin -> Errors. When no channel
 * sent it (all failed or none is set up) that is an error in Admin -> Errors too, unless `quietIfNone` (an alert that
 * other alerts back up, such as the Telegram ping on a hand-over: agents get a push and an email as well).
 */
export async function sendLeadAlert(
  alert: LeadAlert,
  channels: readonly AlertChannel[] = ALERT_CHANNELS,
  opts: { quietIfNone?: boolean } = {},
): Promise<Record<string, ChannelOutcome | "failed">> {
  const results = await Promise.allSettled(channels.map((c) => c.send(alert)));
  const out: Record<string, ChannelOutcome | "failed"> = {};
  await Promise.all(
    results.map(async (r, i) => {
      const id = channels[i].id;
      if (r.status === "fulfilled") out[id] = r.value;
      else {
        out[id] = "failed";
        await logError(r.reason, { source: `lead-alerts.${id}`, level: "warn", kind: alert.kind });
      }
    }),
  );
  if (!opts.quietIfNone && channels.length && !Object.values(out).includes("sent")) {
    const summary = Object.entries(out).map(([id, o]) => `${id} ${o}`).join(", ");
    await logError(new Error(`A ${alert.kind} alert reached nobody (${summary}). Set up email or Telegram: Admin -> Health lists what is missing.`), { source: "lead-alerts", kind: alert.kind });
  }
  return out;
}

/**
 * The alert after the response: resolves at once (except on Netlify when the host could not take the work, see
 * runInBackground), so callers await it just before they answer. `alert` may be a function that finishes it in the
 * background (a database read the visitor should not wait for). Never throws.
 */
export function alertInBackground(
  alert: LeadAlert | (() => Promise<LeadAlert>),
  label = "lead alert",
  channels: readonly AlertChannel[] = ALERT_CHANNELS,
  opts: { quietIfNone?: boolean } = {},
): Promise<void> {
  return runInBackground(async () => sendLeadAlert(typeof alert === "function" ? await alert() : alert, channels, opts), label).catch(() => {});
}
