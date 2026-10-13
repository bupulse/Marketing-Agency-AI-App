import "server-only";
import type { BillingProvider } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { applyProviderSubscription } from "./apply";
import { sendCarryOverAlertEmail } from "./momo-emails";
import { billingAdapter } from "./index";

// The card renewal of a Mobile Money plan (docs/BILLING.md, "Renewing"): the card subscription's first charge is moved
// to one period after the end of the days already paid by Mobile Money. The intent is written first (CardCarryOver),
// then the provider is asked; a failure is logged (ErrorLog `billing.carry_over`), the admins are emailed, and the daily
// renewals job tries again up to CARRY_OVER_MAX_ATTEMPTS times before marking it failed (credit the days by hand).

export const CARRY_OVER_MAX_ATTEMPTS = 5;

type Row = { id: string; provider: string; providerSubscriptionId: string; userId: string | null; nextBilledAt: Date; attempts: number; alertedAt: Date | null };

/** Records the carry-over (once per card subscription) and tries it now. */
export async function carryOverMomoDays(input: { provider: BillingProvider; providerSubscriptionId: string; userId: string | null; nextBilledAt: Date }, now: Date = new Date()) {
  const existing = await prisma.cardCarryOver.findUnique({ where: { providerSubscriptionId: input.providerSubscriptionId } });
  if (existing && existing.status !== "pending") return existing.status;
  const row = existing ?? (await prisma.cardCarryOver.create({ data: { provider: input.provider, providerSubscriptionId: input.providerSubscriptionId, userId: input.userId, nextBilledAt: input.nextBilledAt } }));
  return runCarryOver(row, now);
}

async function runCarryOver(row: Row, now: Date): Promise<"done" | "pending" | "failed"> {
  try {
    const adapter = billingAdapter(row.provider as BillingProvider);
    if (!adapter.deferNextBilling) throw new Error(`${row.provider} cannot move a subscription's next charge`);
    const updated = await adapter.deferNextBilling(row.providerSubscriptionId, row.nextBilledAt);
    await applyProviderSubscription(row.provider as BillingProvider, updated);
    await prisma.cardCarryOver.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "done", doneAt: now, attempts: row.attempts + 1, lastError: null } });
    return "done";
  } catch (error) {
    const attempts = row.attempts + 1;
    const gaveUp = attempts >= CARRY_OVER_MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    await logError(error, { source: "billing.carry_over", userId: row.userId ?? undefined, providerSubscriptionId: row.providerSubscriptionId, nextBilledAt: row.nextBilledAt.toISOString(), attempts });
    // Alert on the first failure and when retrying stops.
    const alert = !row.alertedAt || gaveUp;
    const emailed = alert ? await sendCarryOverAlertEmail({ providerSubscriptionId: row.providerSubscriptionId, userId: row.userId, nextBilledAt: row.nextBilledAt, attempts, gaveUp, error: message }).catch(() => false) : false;
    await prisma.cardCarryOver.updateMany({ where: { id: row.id, status: "pending" }, data: { attempts, lastError: message, status: gaveUp ? "failed" : "pending", ...(emailed ? { alertedAt: now } : {}) } });
    return gaveUp ? "failed" : "pending";
  }
}

/** The daily retry (renewals job): every pending carry-over is tried again. Returns how many went through. */
export async function retryCarryOvers(now: Date = new Date(), limit = 50): Promise<number> {
  const rows = await prisma.cardCarryOver.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: limit });
  let done = 0;
  for (const row of rows) if ((await runCarryOver(row, now)) === "done") done++;
  return done;
}
