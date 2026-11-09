import "server-only";
import { adminEmails } from "@/lib/admin/auth";
import { isServiceEnabled } from "@/lib/admin/switch";
import { escapeTelegramHtml } from "@/lib/lead-alerts/format";
import { sendTelegramMessage } from "@/lib/lead-alerts/telegram";
import { readTelegramChat } from "@/lib/lead-alerts/telegram-settings";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { supportAppUrl } from "@/lib/support/alerts";
import { durationWords, kigaliTime, type Outage } from "./uptime-rules";

// The "bupulse.com is back up" alert, sent by the server on the first good outside check after an outage
// (lib/monitor/uptime.ts). The "down" alert cannot come from here (the server is the thing that is down): the GitHub
// workflow sends it (scripts/monitor/uptime-check.mjs). Same channels as the lead alerts: email to the admin address
// through Resend, and Telegram to the chat connected in Admin -> Settings -> Lead alerts. Never throws.

export type AlertOutcome = "sent" | "skipped" | "failed";

const OWNER = "admin@bupulse.com";

export function backUpText(o: Outage): { subject: string; line: string } {
  return {
    subject: `bupulse.com is back up (down about ${durationWords(o.minutes)})`,
    line: `bupulse.com is back up. It was down for about ${durationWords(o.minutes)}, from ${kigaliTime(o.startedAt)} to ${kigaliTime(o.endedAt)} (Kigali time).`,
  };
}

export async function sendBackUpAlert(o: Outage): Promise<Record<string, AlertOutcome>> {
  const { subject, line } = backUpText(o);
  const link = supportAppUrl("/server");
  const [email, telegram] = await Promise.all([
    (async (): Promise<AlertOutcome> => {
      try {
        if (!(await isServiceEnabled("resend")) || !process.env.RESEND_API_KEY) return "skipped";
        const to = adminEmails().includes(OWNER) ? [OWNER] : adminEmails().length ? adminEmails() : [OWNER];
        const { html, text } = renderEmail({
          heading: "bupulse.com is back up",
          intro: line,
          blocks: [
            { label: "Down from", value: `${kigaliTime(o.startedAt)} (last good check)` },
            { label: "Up again", value: `${kigaliTime(o.endedAt)} (first good check)` },
          ],
          button: { label: "Open the server page", url: link },
          footer: "Checked from outside every 5 minutes by GitHub Actions. Times are the checks around the outage, so it may have been a little shorter.",
        });
        let sent = 0;
        for (const address of to) if (await sendEmail({ to: address, subject, html, text })) sent++;
        return sent ? "sent" : "failed";
      } catch {
        return "failed";
      }
    })(),
    (async (): Promise<AlertOutcome> => {
      try {
        // The switch check also loads the token saved in Admin -> Services into process.env.
        if (!(await isServiceEnabled("telegram"))) return "skipped";
        const chat = await readTelegramChat();
        const r = await sendTelegramMessage({ chatId: chat?.chatId, text: `✅ ${escapeTelegramHtml(line)}`, buttons: link.startsWith("https://") ? [[{ text: "Open the server page", url: link }]] : undefined });
        return r.ok ? "sent" : r.skipped ? "skipped" : "failed";
      } catch {
        return "failed";
      }
    })(),
  ]);
  return { email, telegram };
}
