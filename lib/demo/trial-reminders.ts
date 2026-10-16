import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { isServiceEnabled } from "@/lib/admin/switch";
import { consoleContext } from "@/lib/admin/types";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { logError } from "@/lib/errors";
import { getPlan } from "@/lib/plan-catalog";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { formatSlot } from "./slots";

// The end of the trial (hourly cron, /api/cron/trial-reminders). For clients without a card on file (MoMo clients,
// and anyone who has not added a card), two reminders: one with a day to go ("day 2" of a 3-day trial) and one on the
// last day, each recorded on the subscription BEFORE it is sent so it goes out at most once. When the trial ends
// without a payment the subscription becomes EXPIRED: the existing paywall makes the account read-only (nothing is
// deleted, lib/usage.ts answers trial_expired), and a last email says so. Card clients are left to Paddle: their trial
// subscription converts or cancels through the webhooks (TODO behind the Paddle adapter, docs/REGIONS.md).

const HOUR = 3_600_000;
/** The first reminder goes out when this much of the trial is left. */
export const REMINDER_1_BEFORE_MS = 24 * HOUR;
/** The last-day reminder. */
export const REMINDER_2_BEFORE_MS = 8 * HOUR;
/** A trial shorter than this gets only the last-day reminder (the first would fire at the start). */
const MIN_FOR_FIRST_MS = 36 * HOUR;
/** A trial that ended longer ago than this (a legacy row from before the cron existed) is closed without an email. */
export const ENDED_EMAIL_WINDOW_MS = 48 * HOUR;
const BATCH = 200;

const systemContext = () => ({ ...consoleContext(null), actor: "system:cron" });

export type TrialRun = { reminded1: number; reminded2: number; expired: number; paused: boolean };

type Row = { id: string; userId: string; plan: string; chosenPlan: string | null; trialEndsAt: Date | null; currentPeriodStart: Date; trialReminder1SentAt: Date | null; trialReminder2SentAt: Date | null; providerSubscriptionId: string | null; user: { email: string; name: string | null; business: { id: string; name: string } | null } };

async function sendReminder(row: Row, lastDay: boolean, now: Date): Promise<boolean> {
  const plan = row.chosenPlan ? await getPlan(row.chosenPlan) : null;
  const ends = row.trialEndsAt!;
  const hoursLeft = Math.max(1, Math.round((ends.getTime() - now.getTime()) / HOUR));
  const first = row.user.name?.split(/\s+/)[0];
  const { html, text } = renderEmail({
    heading: lastDay ? "Your free trial ends today" : "Your free trial ends tomorrow",
    intro: `${first ? `Hi ${first}, ` : ""}your BuPulse trial${plan ? ` of the ${plan.name} plan` : ""} ends ${lastDay ? `in about ${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"}` : "tomorrow"}, on ${formatSlot(ends)} (Africa/Kigali). To keep creating, pay from the Billing page before then. If you do nothing, your account becomes read-only: everything you made stays saved, and you can pay later to carry on.`,
    blocks: [{ label: "Trial ends", value: `${formatSlot(ends)} (Africa/Kigali)` }, ...(plan ? [{ label: "Your plan", value: plan.name }] : [])],
    button: { label: "Choose how to pay", url: `${publicSiteUrl()}/dashboard/billing` },
    footer: "Questions? Reply to this email and we will help.",
  });
  return sendEmail({ to: row.user.email, subject: lastDay ? "Your BuPulse trial ends today" : "Your BuPulse trial ends tomorrow", html, text });
}

async function sendEnded(row: Row): Promise<boolean> {
  const plan = row.chosenPlan ? await getPlan(row.chosenPlan) : null;
  const first = row.user.name?.split(/\s+/)[0];
  const { html, text } = renderEmail({
    heading: "Your free trial has ended",
    intro: `${first ? `Hi ${first}, ` : ""}your BuPulse trial is over. Your account is now read-only: everything you made is saved, nothing is deleted. Pay for ${plan ? `the ${plan.name} plan` : "a plan"} from the Billing page whenever you want to pick up where you left off.`,
    button: { label: "Keep going", url: `${publicSiteUrl()}/dashboard/billing` },
    footer: "Questions? Reply to this email and we will help.",
  });
  return sendEmail({ to: row.user.email, subject: "Your BuPulse trial has ended", html, text });
}

/** One hourly run. Idempotent: reminders are claimed with a conditional write, expiry is a status flip that cannot repeat. */
export async function processTrialReminders(now = new Date()): Promise<TrialRun> {
  const out: TrialRun = { reminded1: 0, reminded2: 0, expired: 0, paused: false };
  const select = { id: true, userId: true, plan: true, chosenPlan: true, trialEndsAt: true, currentPeriodStart: true, trialReminder1SentAt: true, trialReminder2SentAt: true, providerSubscriptionId: true, user: { select: { email: true, name: true, business: { select: { id: true, name: true } } } } } as const;

  // 1. Trials that are over: read-only from now on (lib/usage.ts already refuses; the status makes it visible everywhere).
  const over = (await prisma.subscription.findMany({ where: { status: "TRIALING", plan: "TRIAL", providerSubscriptionId: null, trialEndsAt: { lt: now } }, select, take: BATCH })) as Row[];
  for (const row of over) {
    const { count } = await prisma.subscription.updateMany({ where: { id: row.id, status: "TRIALING", trialEndsAt: row.trialEndsAt }, data: { status: "EXPIRED" } });
    if (count !== 1) continue;
    out.expired++;
    const legacy = now.getTime() - row.trialEndsAt!.getTime() > ENDED_EMAIL_WINDOW_MS;
    await writeAudit(prisma, systemContext(), "trial_expired", `user:${row.userId}`, { status: "TRIALING", trialEndsAt: row.trialEndsAt }, { status: "EXPIRED", emailed: !legacy }).catch(() => undefined);
    // Only trials that ended recently are told; one that ended days or weeks ago (before this cron existed) is closed quietly.
    if (!legacy && (await isServiceEnabled("resend"))) await sendEnded(row).catch((e) => logError(e, { source: "trial.ended-email", userId: row.userId }));
  }

  // 2. Reminders, only while Resend is on (otherwise nothing is claimed and the next run tries again).
  if (!(await isServiceEnabled("resend"))) return { ...out, paused: true };
  const live = (await prisma.subscription.findMany({ where: { status: "TRIALING", plan: "TRIAL", providerSubscriptionId: null, trialEndsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_1_BEFORE_MS) } }, select, take: BATCH })) as Row[];
  for (const row of live) {
    const ends = row.trialEndsAt!.getTime();
    const left = ends - now.getTime();
    const length = ends - row.currentPeriodStart.getTime();
    if (left <= REMINDER_2_BEFORE_MS && !row.trialReminder2SentAt) {
      const { count } = await prisma.subscription.updateMany({ where: { id: row.id, trialReminder2SentAt: null }, data: { trialReminder2SentAt: now } });
      if (count !== 1) continue;
      const sent = await sendReminder(row, true, now).catch(() => false);
      if (sent) out.reminded2++;
      else await prisma.subscription.updateMany({ where: { id: row.id, trialReminder2SentAt: now }, data: { trialReminder2SentAt: null } });
      continue;
    }
    if (left <= REMINDER_1_BEFORE_MS && left > REMINDER_2_BEFORE_MS && !row.trialReminder1SentAt && length >= MIN_FOR_FIRST_MS) {
      const { count } = await prisma.subscription.updateMany({ where: { id: row.id, trialReminder1SentAt: null }, data: { trialReminder1SentAt: now } });
      if (count !== 1) continue;
      const sent = await sendReminder(row, false, now).catch(() => false);
      if (sent) out.reminded1++;
      else await prisma.subscription.updateMany({ where: { id: row.id, trialReminder1SentAt: now }, data: { trialReminder1SentAt: null } });
    }
  }
  return out;
}
