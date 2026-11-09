import "server-only";
import { adminEmails } from "@/lib/admin/auth";
import type { HealthIssue } from "@/lib/admin/health";
import { isServiceEnabled } from "@/lib/admin/switch";
import { telegramStatus } from "./telegram-settings";

// Is every alert channel the owner relies on actually able to send? Admin -> Health (and so the Overview's "Needs you"
// box and the sidebar badge) lists what is missing, so a quote request is never alerted on fewer channels than the
// owner thinks. A channel switched off on purpose in Admin -> Services is not an issue.

export type AlertSetup = {
  email: { enabled: boolean; hasKey: boolean; recipients: number };
  telegram: { enabled: boolean; hasToken: boolean; chatConnected: boolean };
};

/** The missing pieces, as Health issues. Pure: tests/lead-alerts/setup.test.ts. */
export function alertSetupIssues(s: AlertSetup): HealthIssue[] {
  const issues: HealthIssue[] = [];
  if (s.email.enabled && (!s.email.hasKey || s.email.recipients === 0)) {
    const why = !s.email.hasKey ? "RESEND_API_KEY is not set" : "ADMIN_EMAILS has no address";
    issues.push({ level: "problem", key: "alerts:email", text: `Alert emails cannot be sent: ${why}. Quote requests and website chats are saved but nobody is emailed.`, href: "/admin/services" });
  }
  if (s.telegram.enabled && !s.telegram.hasToken) {
    issues.push({
      level: "warning",
      key: "alerts:telegram",
      text: "Telegram alerts are not set up: no bot token (TELEGRAM_BOT_TOKEN on the Telegram card in Services). Quote requests and chats reach you by email only. Not wanted? Switch Telegram off in Services.",
      href: "/admin/services",
    });
  } else if (s.telegram.enabled && !s.telegram.chatConnected) {
    issues.push({
      level: "warning",
      key: "alerts:telegram",
      text: "Telegram has a bot token but no chat is connected, so no Telegram alert is sent. Send /start to the bot, then press Connect in Settings, Lead alerts.",
      href: "/admin/settings",
    });
  }
  return issues;
}

/** Reads the current setup. Never throws: a read that fails gives null, which adds no issue (Health does not cry wolf). */
export async function loadAlertSetup(): Promise<AlertSetup | null> {
  try {
    // The switch check loads the keys saved in Admin -> Services into process.env first.
    const [emailOn, telegram] = await Promise.all([isServiceEnabled("resend"), telegramStatus()]);
    return {
      email: { enabled: emailOn, hasKey: !!process.env.RESEND_API_KEY, recipients: adminEmails().length },
      telegram: { enabled: telegram.enabled, hasToken: telegram.hasToken, chatConnected: !!telegram.chat },
    };
  } catch {
    return null;
  }
}
