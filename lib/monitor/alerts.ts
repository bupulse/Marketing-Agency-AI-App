import "server-only";
import { adminEmails } from "@/lib/admin/auth";
import { isServiceEnabled } from "@/lib/admin/switch";
import { escapeTelegramHtml } from "@/lib/lead-alerts/format";
import { sendTelegramMessage } from "@/lib/lead-alerts/telegram";
import { readTelegramChat, resolveTelegramToken } from "@/lib/lead-alerts/telegram-settings";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { supportAppUrl } from "@/lib/support/alerts";
import { durationWords, kigaliTime, type Outage } from "./uptime-rules";

// The owner's site alerts: "bupulse.com is back up", sent by the server on the first good outside check after an
// outage (lib/monitor/uptime.ts), and the server PC's minute-by-minute "down" and "back up" messages (lib/monitor/
// watch.ts, from the supervisor's reports). When the whole PC is off nothing here can run: the GitHub workflow can send
// that "down" alert (scripts/monitor/uptime-check.mjs, on unless UPTIME_DOWN_ALERT=off). Same channels as the
// lead alerts: email to the admin address through Resend, and Telegram to the chat connected in Admin -> Settings ->
// Lead alerts, with the bot token from Admin -> Services or the environment (resolveTelegramToken). Never throws.

export type AlertOutcome = "sent" | "skipped" | "failed";

const OWNER = "admin@bupulse.com";

export function backUpText(o: Outage): { subject: string; line: string } {
  return {
    subject: `bupulse.com is back up (down about ${durationWords(o.minutes)})`,
    line: `bupulse.com is back up. It was down for about ${durationWords(o.minutes)}, from ${kigaliTime(o.startedAt)} to ${kigaliTime(o.endedAt)} (Kigali time).`,
  };
}

export type OwnerAlert = {
  subject: string;
  heading: string;
  line: string;
  /** Put before the Telegram text. */
  emoji: string;
  blocks?: { label: string; value: string }[];
  footer?: string;
};

/** One message to the owner by email and Telegram, each only when it is switched on and set up. */
export async function sendOwnerAlert(a: OwnerAlert): Promise<Record<string, AlertOutcome>> {
  const link = supportAppUrl("/server");
  const [email, telegram] = await Promise.all([
    (async (): Promise<AlertOutcome> => {
      try {
        if (!(await isServiceEnabled("resend")) || !process.env.RESEND_API_KEY) return "skipped";
        const to = adminEmails().includes(OWNER) ? [OWNER] : adminEmails().length ? adminEmails() : [OWNER];
        const { html, text } = renderEmail({ heading: a.heading, intro: a.line, blocks: a.blocks, button: { label: "Open the server page", url: link }, footer: a.footer });
        let sent = 0;
        for (const address of to) if (await sendEmail({ to: address, subject: a.subject, html, text })) sent++;
        return sent ? "sent" : "failed";
      } catch {
        return "failed";
      }
    })(),
    (async (): Promise<AlertOutcome> => {
      try {
        if (!(await isServiceEnabled("telegram"))) return "skipped";
        const token = await resolveTelegramToken();
        const chat = await readTelegramChat();
        const r = await sendTelegramMessage({ token, chatId: chat?.chatId, text: `${a.emoji} ${escapeTelegramHtml(a.line)}`, buttons: link.startsWith("https://") ? [[{ text: "Open the server page", url: link }]] : undefined });
        return r.ok ? "sent" : r.skipped ? "skipped" : "failed";
      } catch {
        return "failed";
      }
    })(),
  ]);
  return { email, telegram };
}

export async function sendBackUpAlert(o: Outage): Promise<Record<string, AlertOutcome>> {
  const { subject, line } = backUpText(o);
  return sendOwnerAlert({
    subject,
    heading: "bupulse.com is back up",
    line,
    emoji: "✅",
    blocks: [
      { label: "Down from", value: `${kigaliTime(o.startedAt)} (last good check)` },
      { label: "Up again", value: `${kigaliTime(o.endedAt)} (first good check)` },
    ],
    footer: "Checked from outside every 5 minutes by GitHub Actions and the server PC. Times are the checks around the outage, so it may have been a little shorter.",
  });
}
