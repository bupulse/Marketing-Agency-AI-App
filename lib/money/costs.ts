import "server-only";
// Costs: recurring costs and provider bills (audited admin writes), and the month-by-month cost report.
// The rules are in ./costs-shared.ts.
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { getSetting } from "@/lib/admin/settings";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { buildMonthCosts, monthsBetween, providerBillSchema, recurringCostSchema, toMinorUnits, usdCentsOf, type LedgerMonth, type MonthCosts, type ProviderBillInput, type RecurringCostInput, type RecurringCostRow } from "./costs-shared";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form.";

export async function listRecurringCosts(): Promise<RecurringCostRow[]> {
  return prisma.recurringCost.findMany({
    orderBy: [{ endMonth: { sort: "asc", nulls: "first" } }, { category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, provider: true, category: true, amountMinor: true, currency: true, period: true, startMonth: true, endMonth: true, note: true },
  });
}

/** Adds a recurring cost, or changes one (`id`). Audited. */
export async function saveRecurringCost(ctx: AdminContext, input: RecurringCostInput & { id?: string }) {
  const parsed = recurringCostSchema.safeParse(input);
  if (!parsed.success) throw new AdminError("invalid", firstIssue(parsed.error));
  const v = parsed.data;
  const data = { name: v.name, provider: v.provider, category: v.category, amountMinor: toMinorUnits(v.amount, v.currency), currency: v.currency, period: v.period, startMonth: v.startMonth, endMonth: v.endMonth || null, note: v.note || null, updatedBy: ctx.actor };
  return prisma.$transaction(async (tx) => {
    if (input.id) {
      const before = await tx.recurringCost.findUnique({ where: { id: input.id } });
      if (!before) throw new AdminError("not_found", "That cost no longer exists.");
      const saved = await tx.recurringCost.update({ where: { id: input.id }, data });
      await writeAudit(tx, ctx, "update_recurring_cost", `cost:${saved.id}`, before, saved);
      return saved;
    }
    const saved = await tx.recurringCost.create({ data });
    await writeAudit(tx, ctx, "add_recurring_cost", `cost:${saved.id}`, null, saved);
    return saved;
  });
}

/** Stops a recurring cost from a month on (keeps history), or deletes it outright when it never applied. Audited. */
export async function endRecurringCost(ctx: AdminContext, id: string, lastMonth: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(lastMonth)) throw new AdminError("invalid", "Pick the last month it was paid.");
  await prisma.$transaction(async (tx) => {
    const before = await tx.recurringCost.findUnique({ where: { id } });
    if (!before) throw new AdminError("not_found", "That cost no longer exists.");
    if (lastMonth < before.startMonth) {
      await tx.recurringCost.delete({ where: { id } });
      await writeAudit(tx, ctx, "delete_recurring_cost", `cost:${id}`, before, null);
      return;
    }
    const saved = await tx.recurringCost.update({ where: { id }, data: { endMonth: lastMonth, updatedBy: ctx.actor } });
    await writeAudit(tx, ctx, "end_recurring_cost", `cost:${id}`, before, saved);
  });
}

export async function deleteRecurringCost(ctx: AdminContext, id: string) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.recurringCost.findUnique({ where: { id } });
    if (!before) throw new AdminError("not_found", "That cost no longer exists.");
    await tx.recurringCost.delete({ where: { id } });
    await writeAudit(tx, ctx, "delete_recurring_cost", `cost:${id}`, before, null);
  });
}

export type ProviderBillRow = { id: string; provider: string; month: string; amountMinor: number; currency: string; usdCents: number; usdRate: number | null; note: string | null; updatedAt: Date };

export async function listProviderBills(): Promise<ProviderBillRow[]> {
  return prisma.providerBill.findMany({ orderBy: [{ month: "desc" }, { provider: "asc" }], select: { id: true, provider: true, month: true, amountMinor: true, currency: true, usdCents: true, usdRate: true, note: true, updatedAt: true } });
}

/** Saves a provider's real bill for a month (replaces the one entered before). An RWF bill is converted at today's rate. Audited. */
export async function saveProviderBill(ctx: AdminContext, input: ProviderBillInput) {
  const parsed = providerBillSchema.safeParse(input);
  if (!parsed.success) throw new AdminError("invalid", firstIssue(parsed.error));
  const v = parsed.data;
  const rate = v.currency === "RWF" ? await getSetting("usdToRwf") : null;
  const amountMinor = toMinorUnits(v.amount, v.currency);
  const usdCents = Math.round(usdCentsOf(amountMinor, v.currency, rate ?? 0));
  return prisma.$transaction(async (tx) => {
    const before = await tx.providerBill.findUnique({ where: { provider_month: { provider: v.provider, month: v.month } } });
    const data = { amountMinor, currency: v.currency, usdCents, usdRate: rate, note: v.note || null, enteredBy: ctx.actor };
    const saved = await tx.providerBill.upsert({ where: { provider_month: { provider: v.provider, month: v.month } }, create: { provider: v.provider, month: v.month, ...data }, update: data });
    await writeAudit(tx, ctx, "set_provider_bill", `bill:${v.provider}:${v.month}`, before, saved);
    return saved;
  });
}

export async function deleteProviderBill(ctx: AdminContext, id: string) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.providerBill.findUnique({ where: { id } });
    if (!before) throw new AdminError("not_found", "That bill no longer exists.");
    await tx.providerBill.delete({ where: { id } });
    await writeAudit(tx, ctx, "delete_provider_bill", `bill:${before.provider}:${before.month}`, before, null);
  });
}

/** The AI ledger summed per month and provider (USD cents), from `from` ("YYYY-MM") to now. */
export async function ledgerByMonth(from: string, to?: string): Promise<LedgerMonth[]> {
  const start = new Date(`${from}-01T00:00:00Z`);
  const end = to ? new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 1)) : new Date(Date.UTC(9999, 0, 1));
  const rows = await prisma.$queryRaw<{ month: string; provider: string; cost: unknown; calls: bigint; estimated: bigint }[]>`
    SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, "provider", COALESCE(SUM("costUsd"), 0) AS cost,
           COUNT(*) AS calls, COUNT(*) FILTER (WHERE "estimated") AS estimated
    FROM "AiCall" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY 1, 2`;
  return rows.map((r) => ({ month: r.month, provider: r.provider, cents: Number(r.cost ?? 0) * 100, calls: Number(r.calls), estimatedCalls: Number(r.estimated) }));
}

/** Every cost line of each month from `from` to `to` (inclusive). */
export async function getMonthCosts(from: string, to: string): Promise<{ months: MonthCosts[]; rwfPerUsd: number }> {
  const months = monthsBetween(from, to);
  const [ledger, bills, recurring, entered, rwfPerUsd] = await Promise.all([
    ledgerByMonth(from, to),
    prisma.providerBill.findMany({ where: { month: { in: months } }, select: { provider: true, month: true, usdCents: true } }),
    listRecurringCosts(),
    prisma.monthlyCost.findMany({ where: { month: { in: months } }, select: { month: true, category: true, amountCents: true } }),
    getSetting("usdToRwf"),
  ]);
  return { months: buildMonthCosts({ months, ledger, bills, recurring, entered, rwfPerUsd }), rwfPerUsd };
}
