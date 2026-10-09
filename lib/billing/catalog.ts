import type { BillingInterval } from "@/lib/generated/prisma/client";

// Plans, prices and price ids live in the database (lib/plan-catalog.ts, managed at /admin/plans). This file keeps the
// small pure helpers and re-exports the loaders so billing code has one import.
export type PaidPlan = string;

export const INTERVALS: BillingInterval[] = ["MONTH", "YEAR"];

export function isInterval(value: unknown): value is BillingInterval {
  return value === "MONTH" || value === "YEAR";
}
