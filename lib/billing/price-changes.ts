import "server-only";
import type { BillingInterval } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import { consoleContext } from "@/lib/admin/types";
import { isServiceEnabled } from "@/lib/admin/switch";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { clearPlanCache, currentPriceId, getPlans, subscriberPriceCents } from "@/lib/plan-catalog";
import { applyProviderSubscription } from "./apply";
import { archivePaddlePrice, getPaddleSubscription, paddleConnected, swapSubscriptionPrice } from "./paddle-catalog";
import { mapSubscription } from "./paddle-map";
import { addMonths } from "./period";
import { linkSiteUrl } from "@/lib/auth/request-site";

// Moving existing subscribers to a plan's new price (PlanPriceChange / PlanPriceChangeItem).
//  - Increase: each client gets an email at least NOTICE_DAYS before the renewal that bills the new price. A renewal less
//    than NOTICE_DAYS away is skipped: the client moves at the renewal after it.
//  - Decrease: the client moves at the next renewal, no notice.
// Paddle cannot schedule an item change for later, so the swap (proration "do_not_bill": nothing billed or credited now)
// is made SWAP_WINDOW_DAYS before the renewal, by the daily cron. The renewal then bills the new price.

export const NOTICE_DAYS = 30;
export const SWAP_WINDOW_DAYS = 2;
export const BATCH_SIZE = 100;
/** A notice that cannot be sent (no email address, no renewal date, Resend refusing) is given up after this many tries. */
export const MAX_ATTEMPTS = 5;
/** A notice sent more than NOTICE_DAYS + this many days (60) before the renewal gets a second reminder 30 days before it. */
export const REMINDER_GAP_DAYS = 30;
/** An item still being worked on after this long belongs to a run that died. */
export const STUCK_MS = 15 * 60_000;
/** Items a cron run can still act on or is acting on. */
export const OPEN_ITEM_STATUSES = ["pending", "notified", "notifying", "swapping"];
const DAY = 86_400_000;

/** The audit actor of the scheduled job. */
const systemContext = () => ({ ...consoleContext(null), actor: "system:cron" });

type Item = {
  id: string;
  changeId: string;
  userId: string;
  providerSubscriptionId: string;
  interval: BillingInterval;
  oldPriceId: string;
  newPriceId: string;
  oldCents: number;
  newCents: number;
  status: string;
  noticeSentAt: Date | null;
  reminderSentAt: Date | null;
  attempts: number;
  effectiveAt: Date | null;
};

/**
 * The first renewal at or after `notBefore`. Every step is counted from the original renewal date (Jan 31 + 2 months =
 * Mar 31, not Feb 28 + 1 month = Mar 28), so the date in the email is the date Paddle bills.
 */
export function firstRenewalOnOrAfter(renewal: Date, interval: BillingInterval, notBefore: Date): Date {
  const step = interval === "YEAR" ? 12 : 1;
  for (let i = 0; i < 60; i++) {
    const d = i === 0 ? renewal : addMonths(renewal, i * step);
    if (d >= notBefore) return d;
  }
  return addMonths(renewal, 60 * step);
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

type SendResult = "sent" | "failed" | "no_email" | "paused";

async function sendNotice(item: Item, planName: string, effectiveAt: Date, reminder = false): Promise<SendResult> {
  // Resend switched off in the admin console: not a failure. The caller waits without counting an attempt.
  if (!(await isServiceEnabled("resend"))) return "paused";
  const user = await prisma.user.findUnique({ where: { id: item.userId }, select: { email: true, name: true } });
  if (!user?.email) return "no_email";
  const per = item.interval === "YEAR" ? "year" : "month";
  const billing = `${(await linkSiteUrl())}/dashboard/billing`;
  const { html, text } = renderEmail({
    heading: reminder ? `A reminder: your ${planName} price changes on ${longDate(effectiveAt)}` : `Your ${planName} price is changing`,
    intro: `${user.name ? `Hi ${user.name.split(/\s+/)[0]}, ` : ""}${reminder ? `this is a reminder that the price of the ${planName} plan changes at your renewal on ${longDate(effectiveAt)}.` : `we are changing the price of the ${planName} plan.`} Nothing changes until your renewal on ${longDate(effectiveAt)}. You will not be charged anything extra before then.`,
    blocks: [
      { label: "Your price now", value: `${usd(item.oldCents)} per ${per}` },
      { label: `New price from ${longDate(effectiveAt)}`, value: `${usd(item.newCents)} per ${per}` },
    ],
    button: { label: "See your plan", url: billing },
    footer: `You can cancel or switch plan any time before ${longDate(effectiveAt)} from the Billing page, and your plan stays active until the end of the period you paid for.`,
  });
  const sent = await sendEmail({ to: user.email, subject: `${reminder ? "Reminder: your" : "Your"} BuPulse ${planName} price changes on ${longDate(effectiveAt)}`, html, text });
  return sent ? "sent" : "failed";
}

type Outcome = "notified" | "applied" | "skipped" | "failed" | "waiting" | "reminded";

function definite4xx(error: unknown) {
  return error instanceof Error && /^Paddle API 4\d\d /.test(error.message) && !/^Paddle API (408|429) /.test(error.message);
}

/** Moves an item from `from` to a new state, only if it is still in `from` AND its change has not been stopped. Returns whether it won. */
async function claim(id: string, from: string, data: Record<string, unknown>): Promise<boolean> {
  const { count } = await prisma.planPriceChangeItem.updateMany({ where: { id, status: from, change: { status: "scheduled" } }, data });
  return count === 1;
}

/** Writes the outcome of work this run claimed. Only lands if the item is still in the claimed state. */
async function settle(id: string, from: string, data: Record<string, unknown>): Promise<boolean> {
  const { count } = await prisma.planPriceChangeItem.updateMany({ where: { id, status: from }, data });
  return count === 1;
}

/** A notice step that did not work: count the try, and give up (failed, shown in the admin) after MAX_ATTEMPTS. */
async function noteAttempt(item: Item, from: string, reason: string, extra: Record<string, unknown> = {}): Promise<Outcome> {
  const attempts = (item.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await settle(item.id, from, { status: "failed", attempts, noticeSentAt: null, effectiveAt: null, error: `${reason} Gave up after ${attempts} tries; retry it from the plan page once it is fixed.` });
    return "failed";
  }
  await settle(item.id, from, { status: from === "notifying" ? "pending" : from, attempts, error: reason, ...extra });
  return "waiting";
}

/**
 * One subscriber: send the notice, or make the swap, or wait. Never throws.
 * Every step that has an effect is claimed first with a conditional write (so a stopped or replaced change, or a second
 * run, cannot be overtaken), and the notice is recorded as sent BEFORE the email goes out: an email is never sent twice.
 */
async function processItem(item: Item, planName: string, now: Date): Promise<Outcome> {
  let claimedAs: string | null = null;
  try {
    const sub = await prisma.subscription.findFirst({
      where: { providerSubscriptionId: item.providerSubscriptionId },
      select: { userId: true, status: true, cancelAtPeriodEnd: true, providerPriceId: true, currentPeriodEnd: true },
    });
    const stillOnOldPrice = sub && sub.providerPriceId === item.oldPriceId && !sub.cancelAtPeriodEnd && (sub.status === "ACTIVE" || sub.status === "PAST_DUE");
    if (!stillOnOldPrice) {
      // The reconciliation step adds them again if they come back (resume, a paused client) and are still on an old price.
      await settle(item.id, item.status, { status: "skipped", error: "No longer on this price (changed plan, cancelling or ended)." });
      return "skipped";
    }
    const increase = item.newCents > item.oldCents;

    // 1. Increase: notice first. The new price may start no earlier than NOTICE_DAYS after the email.
    if (increase && item.status === "pending") {
      if (!sub.currentPeriodEnd) return noteAttempt(item, "pending", "The renewal date of this subscription is not known yet.");
      const effectiveAt = firstRenewalOnOrAfter(sub.currentPeriodEnd, item.interval, new Date(now.getTime() + NOTICE_DAYS * DAY));
      // Resend is off: wait before claiming, so nothing is recorded as sent or counted as tried.
      if (!(await isServiceEnabled("resend"))) return "waiting";
      if (!(await claim(item.id, "pending", { status: "notifying", noticeSentAt: now, effectiveAt, error: null }))) return "waiting";
      claimedAs = "notifying";
      let sent: SendResult = "failed";
      try {
        sent = await sendNotice(item, planName, effectiveAt);
      } catch {
        sent = "failed";
      }
      if (sent === "sent") {
        await settle(item.id, "notifying", { status: "notified", error: null });
        claimedAs = null;
        return "notified";
      }
      if (sent === "paused") {
        // Switched off after the claim: back to pending, nothing counted.
        await settle(item.id, "notifying", { status: "pending", noticeSentAt: null, effectiveAt: null, error: null });
        claimedAs = null;
        return "waiting";
      }
      // The send is known not to have happened: back to waiting (counted), to try again on the next run.
      const out = await noteAttempt(item, "notifying", sent === "no_email" ? "This client has no email address, so the notice cannot be sent." : "The notice email could not be sent.", { noticeSentAt: null, effectiveAt: null });
      claimedAs = null;
      return out;
    }

    // 1b. A notice sent long before the renewal (yearly clients) gets one reminder about 30 days before it, once.
    if (item.status === "notified" && item.noticeSentAt && item.effectiveAt && !item.reminderSentAt) {
      const ahead = item.effectiveAt.getTime() - item.noticeSentAt.getTime();
      const until = item.effectiveAt.getTime() - now.getTime();
      if (ahead >= (NOTICE_DAYS + REMINDER_GAP_DAYS) * DAY && until <= NOTICE_DAYS * DAY && until > SWAP_WINDOW_DAYS * DAY) {
        // Resend is off: wait without claiming. The reminder window is long, so it goes out once Resend is back on.
        if (!(await isServiceEnabled("resend"))) return "waiting";
        // Claimed (reminderSentAt set) before sending, like the notice: at most once.
        const { count } = await prisma.planPriceChangeItem.updateMany({ where: { id: item.id, status: "notified", reminderSentAt: null, change: { status: "scheduled" } }, data: { reminderSentAt: now } });
        if (count !== 1) return "waiting";
        let sent: SendResult = "failed";
        try {
          sent = await sendNotice(item, planName, item.effectiveAt, true);
        } catch {
          sent = "failed";
        }
        if (sent === "sent") return "reminded";
        await prisma.planPriceChangeItem.updateMany({ where: { id: item.id, status: "notified" }, data: { reminderSentAt: null, error: sent === "paused" ? null : "The reminder email could not be sent; trying again on the next run." } });
        return "waiting";
      }
    }

    // 2. Is the renewal close enough to swap? Ask Paddle for the real next billing date.
    const live = await getPaddleSubscription(item.providerSubscriptionId);
    // A paused client is moved when they resume (the notice rule still applies to the date they resume with).
    if (live.status === "paused") return "waiting";
    if (live.cancelScheduled || (live.status !== "active" && live.status !== "past_due")) {
      await settle(item.id, item.status, { status: "skipped", error: `Subscription is ${live.cancelScheduled ? "being cancelled" : live.status} in Paddle.` });
      return "skipped";
    }
    if (live.priceId !== item.oldPriceId) {
      await settle(item.id, item.status, { status: "skipped", error: "Paddle shows a different price already." });
      return "skipped";
    }
    const next = live.nextBilledAt ?? live.periodEnd;
    if (!next) return "waiting";
    if (increase && item.noticeSentAt) {
      // The renewal must still be NOTICE_DAYS after the notice; if Paddle's date is earlier, move to the one after.
      const earliest = new Date(item.noticeSentAt.getTime() + NOTICE_DAYS * DAY);
      if (next < earliest) {
        await settle(item.id, item.status, { status: item.status, effectiveAt: firstRenewalOnOrAfter(next, item.interval, earliest), error: null });
        return "waiting";
      }
    }
    const due = increase && item.effectiveAt ? item.effectiveAt : next;
    if (due.getTime() - now.getTime() > SWAP_WINDOW_DAYS * DAY || next.getTime() - now.getTime() > SWAP_WINDOW_DAYS * DAY) return "waiting";

    // 3. Claim the swap, then check once more that this price change is still the one in force.
    if (!(await claim(item.id, item.status, { status: "swapping", error: null }))) return "waiting";
    claimedAs = "swapping";
    const change = await prisma.planPriceChange.findUnique({ where: { id: item.changeId }, select: { status: true, planKey: true } });
    const plan = change ? (await getPlans({ force: true })).find((p) => p.key === change.planKey) : null;
    if (!change || change.status !== "scheduled" || !plan || currentPriceId("PADDLE", plan, item.interval) !== item.newPriceId) {
      await settle(item.id, "swapping", { status: "skipped", error: "This price change was stopped or replaced." });
      claimedAs = null;
      return "skipped";
    }
    const entity = await swapSubscriptionPrice(item.providerSubscriptionId, item.newPriceId);
    try {
      const mapped = mapSubscription(entity, now);
      if (mapped) await applyProviderSubscription("PADDLE", mapped);
    } catch (error) {
      // The swap happened; the webhook brings our copy up to date.
      await logError(error, { source: "billing.price-change.apply", itemId: item.id });
    }
    await settle(item.id, "swapping", { status: "applied", appliedAt: now, effectiveAt: next, error: null });
    claimedAs = null;
    return "applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError(error, { source: "billing.price-change", itemId: item.id });
    // A definite refusal from Paddle needs a person; a network or 5xx failure is simply tried again next run.
    if (definite4xx(error)) {
      await settle(item.id, claimedAs ?? item.status, { status: "failed", error: message.slice(0, 300) }).catch(() => undefined);
      return "failed";
    }
    if (claimedAs === "swapping") await settle(item.id, "swapping", { status: item.status, error: message.slice(0, 300) }).catch(() => undefined);
    else if (!claimedAs) await settle(item.id, item.status, { status: item.status, error: message.slice(0, 300) }).catch(() => undefined);
    return "waiting";
  }
}

export type PriceChangeRun = {
  processed: number; notified: number; applied: number; skipped: number; failed: number; waiting: number;
  nextCursor: string | null; archivedPrices: number; completed: number; reconciled: number; recovered: number; reminded: number;
  /** True when another run holds the lock; nothing was done. */
  busy?: boolean;
};

/** Recomputes the counters of a change from its items, and completes it when nobody is left to move. */
export async function refreshChange(changeId: string, now: Date): Promise<boolean> {
  const items = await prisma.planPriceChangeItem.findMany({ where: { changeId }, select: { status: true, noticeSentAt: true } });
  const open = items.filter((i) => OPEN_ITEM_STATUSES.includes(i.status)).length;
  const change = await prisma.planPriceChange.findUnique({ where: { id: changeId }, select: { status: true } });
  const data: Record<string, unknown> = {
    subscribers: items.length,
    notifiedCount: items.filter((i) => i.noticeSentAt).length,
    appliedCount: items.filter((i) => i.status === "applied").length,
    failedCount: items.filter((i) => i.status === "failed").length,
  };
  const completing = change?.status === "scheduled" && open === 0;
  if (completing) Object.assign(data, { status: "completed", completedAt: now });
  await prisma.planPriceChange.update({ where: { id: changeId }, data });
  return completing;
}

/**
 * Work left behind by a run that died: a swap that was started is safe to repeat (the same item swap is idempotent), but a
 * notice whose sending was cut short is not known to have gone out, so it is not resent by itself and not swapped: it is
 * marked failed for an admin to retry.
 */
async function recoverStuck(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_MS);
  const swaps = await prisma.planPriceChangeItem.updateMany({ where: { status: "swapping", updatedAt: { lt: cutoff } }, data: { status: "notified" } });
  const notices = await prisma.planPriceChangeItem.updateMany({
    where: { status: "notifying", updatedAt: { lt: cutoff } },
    data: { status: "failed", noticeSentAt: null, effectiveAt: null, error: "The run stopped while the notice email was being sent, so it is not known whether it went out. Not resent automatically: retry it from the plan page." },
  });
  return swaps.count + notices.count;
}

/**
 * Anyone live on an old price of their plan with no move waiting gets one: clients paused or cancelling when a change was
 * scheduled and back now, checkouts that finished against an old price, and anyone a move skipped. They go through the same
 * notice rules as the rest. Their moves are collected in one new change per plan.
 */
export async function reconcileSubscribers(now: Date): Promise<number> {
  if (!(await paddleConnected())) return 0;
  let added = 0;
  for (const plan of await getPlans({ force: true })) {
    if (plan.isTrial) continue;
    const currentIds = { MONTH: currentPriceId("PADDLE", plan, "MONTH"), YEAR: currentPriceId("PADDLE", plan, "YEAR") };
    if (!currentIds.MONTH || !currentIds.YEAR || plan.paddlePrices.length === 0) continue;
    const oldIds = plan.paddlePrices.map((p) => p.id).filter((id) => id !== currentIds.MONTH && id !== currentIds.YEAR);
    if (oldIds.length === 0) continue;
    const subs = await prisma.subscription.findMany({
      where: { plan: plan.key, provider: "PADDLE", providerSubscriptionId: { not: null }, status: { in: ["ACTIVE", "PAST_DUE"] }, cancelAtPeriodEnd: false, providerPriceId: { in: oldIds } },
      select: { userId: true, providerSubscriptionId: true, providerPriceId: true, interval: true },
      take: 500,
    });
    if (subs.length === 0) continue;
    // Clients with a move waiting are left alone, and so are failed ones (an admin retries those; they are not re-queued behind their back).
    const ids = subs.map((s) => s.providerSubscriptionId as string);
    const busy = [
      ...(await prisma.planPriceChangeItem.findMany({ where: { status: { in: OPEN_ITEM_STATUSES }, providerSubscriptionId: { in: ids } }, select: { providerSubscriptionId: true } })),
      ...(await prisma.planPriceChangeItem.findMany({ where: { status: "failed", change: { status: { not: "cancelled" } }, providerSubscriptionId: { in: ids } }, select: { providerSubscriptionId: true } })),
    ];
    const busyIds = new Set(busy.map((b) => b.providerSubscriptionId));
    const items = subs.flatMap((s) => {
      const newPriceId = currentIds[s.interval as "MONTH" | "YEAR"];
      if (!s.providerSubscriptionId || !s.providerPriceId || !newPriceId || busyIds.has(s.providerSubscriptionId)) return [];
      const oldCents = subscriberPriceCents(plan, s.providerPriceId, s.interval);
      const newCents = s.interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
      if (oldCents === newCents) return [];
      return [{ userId: s.userId, providerSubscriptionId: s.providerSubscriptionId, interval: s.interval as BillingInterval, oldPriceId: s.providerPriceId, newPriceId, oldCents, newCents }];
    });
    if (items.length === 0) continue;
    const up = items.filter((i) => i.newCents > i.oldCents).length;
    const change = await prisma.planPriceChange.create({
      data: {
        planKey: plan.key,
        direction: up === items.length ? "increase" : up === 0 ? "decrease" : "mixed",
        oldMonthlyCents: plan.monthlyPriceCents, newMonthlyCents: plan.monthlyPriceCents, oldYearlyCents: plan.yearlyPriceCents, newYearlyCents: plan.yearlyPriceCents,
        newMonthlyPriceId: currentIds.MONTH, newYearlyPriceId: currentIds.YEAR,
        status: "scheduled", subscribers: items.length, createdBy: "system:reconcile",
      },
    });
    await prisma.planPriceChangeItem.createMany({ data: items.map((i) => ({ ...i, changeId: change.id })) });
    added += items.length;
  }
  void now;
  return added;
}

async function runBatch(opts: { now?: Date; cursor?: string | null; batchSize?: number }): Promise<PriceChangeRun> {
  const now = opts.now ?? new Date();
  const batch = opts.batchSize ?? BATCH_SIZE;
  const run: PriceChangeRun = { processed: 0, notified: 0, applied: 0, skipped: 0, failed: 0, waiting: 0, nextCursor: null, archivedPrices: 0, completed: 0, reconciled: 0, recovered: 0, reminded: 0 };
  // Housekeeping once per sweep (the first call, without a cursor), not on every batch.
  if (!opts.cursor) {
    run.recovered = await recoverStuck(now);
    run.reconciled = await reconcileSubscribers(now).catch(async (error) => {
      await logError(error, { source: "billing.price-reconcile" });
      return 0;
    });
  }
  const plans = await getPlans();
  const names = new Map(plans.map((p) => [p.key, p.name]));

  const rows = await prisma.planPriceChangeItem.findMany({
    where: { status: { in: ["pending", "notified"] }, change: { status: "scheduled" }, ...(opts.cursor ? { id: { gt: opts.cursor } } : {}) },
    orderBy: { id: "asc" },
    take: batch + 1,
  });
  const changes = await prisma.planPriceChange.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.changeId))] } }, select: { id: true, planKey: true } });
  const planKeyOf = new Map(changes.map((c) => [c.id, c.planKey]));
  const more = rows.length > batch;
  const touched = new Set<string>();
  for (const row of rows.slice(0, batch)) {
    const outcome = await processItem(row as unknown as Item, names.get(planKeyOf.get(row.changeId) ?? "") ?? planKeyOf.get(row.changeId) ?? "", now);
    run.processed++;
    run[outcome === "reminded" ? "reminded" : outcome]++;
    touched.add(row.changeId);
    run.nextCursor = more ? row.id : null;
  }
  for (const id of touched) if (await refreshChange(id, now)) run.completed++;
  if (!more) run.archivedPrices = await archiveUnusedPrices();
  // One audit row per run that did something (quiet days leave no row).
  const { nextCursor, ...summary } = run;
  if (Object.values(summary).some((v) => typeof v === "number" && v > 0 && v !== summary.waiting)) {
    await writeAudit(prisma, systemContext(), "price_change_run", "plan-price-changes", null, { ...summary, more: nextCursor !== null }).catch(() => undefined);
  }
  return run;
}

/**
 * The daily job: notices and swaps for every scheduled price change, then archiving Paddle prices nobody uses. Works on
 * at most BATCH_SIZE subscribers per call; `nextCursor` says there are more (call again with it). Two runs never overlap:
 * a database advisory lock held for the run makes a second one return { busy: true }. (Each item is also claimed with a
 * conditional write, so even without the lock nothing is done twice.)
 */
export async function processPriceChanges(opts: { now?: Date; cursor?: string | null; batchSize?: number } = {}): Promise<PriceChangeRun> {
  return prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('plan-price-changes')) AS locked`;
      if (!row?.locked) return { processed: 0, notified: 0, applied: 0, skipped: 0, failed: 0, waiting: 0, nextCursor: null, archivedPrices: 0, completed: 0, reconciled: 0, recovered: 0, reminded: 0, busy: true };
      return runBatch(opts);
    },
    { timeout: 280_000, maxWait: 10_000 },
  );
}

/** Archives, in Paddle, every old price that no subscription and no waiting move uses any more. */
export async function archiveUnusedPrices(now: Date = new Date()): Promise<number> {
  if (!(await paddleConnected())) return 0;
  let archived = 0;
  // Fresh from the database (never the cache) and written back only if nobody changed the plan meanwhile.
  for (const plan of await getPlans({ force: true })) {
    const current = new Set([plan.paddleMonthlyPriceId, plan.paddleYearlyPriceId]);
    const stale = plan.paddlePrices.filter((p) => !p.archivedAt && !current.has(p.id));
    if (stale.length === 0) continue;
    const history = plan.paddlePrices.map((p) => ({ ...p }));
    let changed = false;
    for (const price of stale) {
      const [users, waiting] = await Promise.all([
        prisma.subscription.count({ where: { providerPriceId: price.id } }),
        prisma.planPriceChangeItem.count({ where: { oldPriceId: price.id, status: { in: OPEN_ITEM_STATUSES } } }),
      ]);
      if (users > 0 || waiting > 0) continue;
      try {
        await archivePaddlePrice(price.id);
        history.find((p) => p.id === price.id)!.archivedAt = now.toISOString();
        archived++;
        changed = true;
        await writeAudit(prisma, systemContext(), "archive_paddle_price", `plan:${plan.key}`, { priceId: price.id, state: "old, used by nobody" }, { archivedAt: now.toISOString() }).catch(() => undefined);
      } catch (error) {
        await logError(error, { source: "billing.price-archive", priceId: price.id });
      }
    }
    if (changed) {
      const { count } = await prisma.planDefinition.updateMany({ where: { key: plan.key, ...(plan.updatedAt ? { updatedAt: plan.updatedAt } : {}) }, data: { paddlePrices: history } });
      // The plan changed while we were archiving: the prices are archived in Paddle, and the next run records it.
      if (count === 0) await logError(new Error("Plan changed while archiving prices; history not written"), { source: "billing.price-archive", plan: plan.key });
      clearPlanCache();
    }
  }
  return archived;
}
