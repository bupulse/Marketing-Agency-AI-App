import "server-only";
import { adminEmails } from "@/lib/admin/auth";
import { isServiceEnabled } from "@/lib/admin/switch";
import { logError } from "@/lib/errors";
import { runInBackground } from "@/lib/leads/background";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { alertFields, alertIntro, alertSubject, telegramButtons, telegramText, type LeadAlert } from "./format";
import { sendTelegramMessage } from "./telegram";
import { readTelegramChat } from "./telegram-settings";

// Instant alerts to the owner about a new lead (a quote request, a help chat on the marketing site), on every channel
// that is set up: email to the admin addresses (free, always on) and Telegram (free, once connected in Admin ->
// Settings). A channel is one entry in ALERT_CHANNELS, so a later one (a phone call through Bland AI or Twilio, which
// cost money per call) is added there and no caller changes. Alerts run after the response (runInBackground: the host's
// waitUntil; on Netlify within the function's 60 s), never slow the form, and a failing channel is logged, never thrown.

export type ChannelOutcome = "sent" | "skipped";

export type AlertChannel = {
  id: string;
  /** Sends the alert, or says it was skipped (not set up). Throws on a real failure, which is logged. */
  send: (alert: LeadAlert) => Promise<ChannelOutcome>;
};

export const emailChannel: AlertChannel = {
  id: "email",
  async send(alert) {
    const to = adminEmails();
    if (!to.length || !(await isServiceEnabled("resend")) || !process.env.RESEND_API_KEY) return "skipped";
    const fields = alertFields(alert);
    const phone = fields.find((f) => f.label === "Phone");
    const whatsapp = fields.find((f) => f.label === "WhatsApp");
    const email = renderEmail({
      heading: alertSubject(alert),
      intro: alertIntro(alert),
      // The two links are buttons; every other detail is a block (the email layout escapes them).
      blocks: fields.filter((f) => f.label !== "WhatsApp").map((f) => ({ label: f.label, value: f.value })),
      button: phone?.href ? { label: `Call ${alert.name.split(/\s+/)[0] || "now"}`, url: phone.href } : alert.openUrl ? { label: "Open", url: alert.openUrl } : undefined,
      secondButton: whatsapp?.href ? { label: "WhatsApp", url: whatsapp.href, color: "#1f9d55" } : undefined,
      footer: alert.openUrl ? `Open it in BuPulse: ${alert.openUrl}` : undefined,
    });
    let sent = 0;
    for (const address of to) if (await sendEmail({ to: address, subject: alertSubject(alert), html: email.html, text: email.text })) sent++;
    if (sent === 0) throw new Error(`no lead alert email was sent (${to.length} admin ${to.length === 1 ? "address" : "addresses"})`);
    return "sent";
  },
};

export const telegramChannel: AlertChannel = {
  id: "telegram",
  async send(alert) {
    // The switch check also loads the token saved in Admin -> Services into process.env.
    if (!(await isServiceEnabled("telegram"))) return "skipped";
    const chat = await readTelegramChat();
    const r = await sendTelegramMessage({ chatId: chat?.chatId, text: telegramText(alert), buttons: telegramButtons(alert, publicSiteUrl()) });
    if (r.ok) return "sent";
    if (r.skipped) return "skipped";
    throw new Error(r.error);
  },
};

/** Every channel, in the order they go out. Add a phone-call channel here later. */
export const ALERT_CHANNELS: readonly AlertChannel[] = [emailChannel, telegramChannel];

/** Sends `alert` on every channel at once. Never throws; a failed channel is written to Admin -> Errors. */
export async function sendLeadAlert(alert: LeadAlert, channels: readonly AlertChannel[] = ALERT_CHANNELS): Promise<Record<string, ChannelOutcome | "failed">> {
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
  return out;
}

/**
 * The alert after the response: resolves at once (except on Netlify when the host could not take the work, see
 * runInBackground), so callers await it just before they answer. `alert` may be a function that finishes it in the
 * background (a database read the visitor should not wait for). Never throws.
 */
export function alertInBackground(alert: LeadAlert | (() => Promise<LeadAlert>), label = "lead alert"): Promise<void> {
  return runInBackground(async () => sendLeadAlert(typeof alert === "function" ? await alert() : alert), label).catch(() => {});
}
