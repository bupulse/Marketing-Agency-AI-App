import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";

/** Suggested categories for the admin form; any short lowercase label is accepted. AI cost comes from the ledger, not from here. */
export const COST_CATEGORIES = ["email", "hosting", "domain", "tools", "other"] as const;

export const monthlyCostSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must look like 2026-10"),
  category: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9 _-]{0,39}$/, "Use a short name such as email or hosting"),
  amountCents: z.number().int().min(0).max(1_000_000_00), // USD cents, up to $1,000,000
  note: z.string().trim().max(200).optional(),
});
export type MonthlyCostInput = z.input<typeof monthlyCostSchema>;
export type MonthlyCostRow = { month: string; category: string; amountCents: number; note: string | null };

export async function listMonthlyCosts(month?: string): Promise<MonthlyCostRow[]> {
  return prisma.monthlyCost.findMany({
    where: month ? { month } : undefined,
    orderBy: [{ month: "desc" }, { category: "asc" }],
    select: { month: true, category: true, amountCents: true, note: true },
  });
}

/** Adds or replaces the cost for that month and category. Throws a ZodError for bad input. */
export async function setMonthlyCost(input: MonthlyCostInput): Promise<MonthlyCostRow> {
  const v = monthlyCostSchema.parse(input);
  return prisma.monthlyCost.upsert({
    where: { month_category: { month: v.month, category: v.category } },
    create: { month: v.month, category: v.category, amountCents: v.amountCents, note: v.note || null },
    update: { amountCents: v.amountCents, note: v.note || null },
    select: { month: true, category: true, amountCents: true, note: true },
  });
}

export async function deleteMonthlyCost(month: string, category: string): Promise<boolean> {
  const { count } = await prisma.monthlyCost.deleteMany({ where: { month, category: category.trim().toLowerCase() } });
  return count > 0;
}
