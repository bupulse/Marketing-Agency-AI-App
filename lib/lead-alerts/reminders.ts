import "server-only";
import { prisma } from "@/lib/db";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { cancelJob, registerJobHandler, scheduleJob } from "@/lib/jobs/due";
import { calledUrl } from "./called-link";
import { telegramChannel } from "./channels";
import type { LeadAlert } from "./format";
import { appUrl } from "@/lib/platform/app-hosts";

// Speed to lead (owner, 31 October 2026): a quote request keeps buzzing the owner's phone on Telegram every 2 minutes,
// up to 5 times, until "✅ Called" is pressed under an alert (or the request is marked called in Admin). Each reminder is
// a DueJob ("lead.reminder", one pending per request); the due-jobs cron runs them, so on a host whose cron runs every
// 5 minutes they come at that pace. Only Telegram reminds: five emails would bury the inbox.

export const REMINDER_KIND = "lead.reminder";
export const REMINDER_EVERY_MS = 2 * 60_000;
export const REMINDERS = 5;

const reminderKey = (quoteId: string) => `${REMINDER_KIND}:${quoteId}`;

/** Plans reminder `n` (1 = the first) for a stored quote request. */
export async function scheduleLeadReminder(quoteId: string, n = 1, now = new Date()) {
  return scheduleJob({ kind: REMINDER_KIND, runAt: new Date(now.getTime() + REMINDER_EVERY_MS), payload: { quoteId, n }, dedupeKey: reminderKey(quoteId) });
}

/** Stops the reminders of a request (it was called). */
export async function cancelLeadReminders(quoteId: string): Promise<void> {
  await cancelJob(reminderKey(quoteId));
}

type Row = { id: string; name: string; phone: string | null; email: string; businessName: string | null; message: string | null; source: string | null; pageUrl: string | null; createdAt: Date };

/** The reminder for a stored request: the quote alert with "Still waiting (n of 5)" first. */
export function reminderAlert(row: Row, n: number, site = publicSiteUrl()): LeadAlert {
  return {
    kind: "quote",
    name: row.name,
    phone: row.phone,
    email: row.email,
    company: row.businessName,
    note: row.message,
    source: row.source,
    page: row.pageUrl ? `${site}${row.pageUrl}` : null,
    at: row.createdAt,
    openUrl: appUrl(`/admin/quotes`, site),
    calledUrl: calledUrl(site, row.id),
    reminder: { n, of: REMINDERS },
  };
}

/** One reminder: nothing when the request is gone or already called; else the Telegram buzz and the next one planned. */
export async function runLeadReminder(payload: unknown): Promise<"sent" | "skipped" | "done"> {
  const { quoteId, n } = (payload ?? {}) as { quoteId?: unknown; n?: unknown };
  if (typeof quoteId !== "string" || typeof n !== "number" || n < 1) return "done";
  const row = await prisma.contactRequest.findUnique({
    where: { id: quoteId },
    select: { id: true, kind: true, handled: true, name: true, phone: true, email: true, businessName: true, message: true, source: true, pageUrl: true, createdAt: true },
  });
  if (!row || row.kind !== "quote" || row.handled) return "done";
  // A Telegram refusal throws, so the job is retried by the runner; a channel that is not set up just stops here.
  const outcome = await telegramChannel.send(reminderAlert(row, Math.min(n, REMINDERS)));
  if (outcome === "skipped") return "skipped";
  if (n < REMINDERS) await scheduleLeadReminder(row.id, n + 1);
  return "sent";
}

registerJobHandler(REMINDER_KIND, async (job) => {
  await runLeadReminder(job.payload);
});
