"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionMessage, adminAction, finish } from "@/lib/admin/console";
import { cancelPriceChange, createPlan, previewPriceChange, retryFailedPriceItems, syncPlanToPaddle, updatePlan, type PlanInput } from "@/lib/admin/plans-service";
import { AdminError } from "@/lib/admin/types";
import { getPlan } from "@/lib/plan-catalog";
import { FEATURE_KEYS } from "@/lib/features";
import { PLAN_STATUSES, USAGE_METRICS, type PlanStatus, type UsageMetric } from "@/lib/plans";

export type PlanFormState = { error?: string; confirm?: { lines: string[]; direction: string; affected: number; monthlyCents: number; yearlyCents: number } };

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** "49", "$49", "49.50" -> cents. NaN when it is not a price. */
function dollarsToCents(raw: string): number {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function numberOf(f: FormData, k: string, label: string): number {
  const raw = text(f, k);
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) throw new AdminError("invalid", `${label} must be a number.`);
  return n;
}

/**
 * Reads the plan form. Prices are typed in dollars, so only a plan priced in dollars takes them: a custom plan (priced by
 * its offer, e.g. in RWF) keeps its price, currency and Paddle prices whatever the form sends.
 */
function readForm(f: FormData, isTrial: boolean, priced = true): Partial<PlanInput> {
  const input: Partial<PlanInput> = {
    name: text(f, "name"),
    description: text(f, "description"),
    sortOrder: numberOf(f, "sortOrder", "The order"),
    highlight: f.get("highlight") === "on",
    limits: {
      ...(Object.fromEntries([...USAGE_METRICS.filter((m) => m !== "videoCredits"), "seats"].map((m) => [m, numberOf(f, `limit_${m}`, m === "seats" ? "Team seats" : `The ${m} limit`)])) as Record<Exclude<UsageMetric, "videoCredits"> | "seats", number>),
      // Video Studio credits (docs/VIDEO_APP_INTEGRATION.md): only when the form sends it, so a form opened before they
      // existed still saves (the plan keeps its credits).
      ...(text(f, "limit_videoCredits") ? { videoCredits: numberOf(f, "limit_videoCredits", "Video Studio credits") } : {}),
      // Posts per app per day (docs/CONTENT.md): only when the form sends it.
      ...(text(f, "limit_postsPerAppPerDay") ? { postsPerAppPerDay: numberOf(f, "limit_postsPerAppPerDay", "Posts per app per day") } : {}),
      // Videos a day (docs/CONTENT_VISUALS.md): only when the form sends it.
      ...(text(f, "limit_videosPerDay") ? { videosPerDay: numberOf(f, "limit_videosPerDay", "Videos per day") } : {}),
    },
    highlights: String(f.get("highlights") ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    // The checklist; the service validates prerequisites and refuses "coming soon" keys (the form only guides).
    features: FEATURE_KEYS.filter((k) => f.get(`feature_${k}`) === "on"),
  };
  if (isTrial) {
    input.trialDays = numberOf(f, "trialDays", "The trial length");
  } else {
    const status = text(f, "status");
    if (!(PLAN_STATUSES as string[]).includes(status)) throw new AdminError("invalid", "Choose active, hidden or retired.");
    input.status = status as PlanStatus;
    if (!priced) return input;
    input.monthlyPriceCents = dollarsToCents(text(f, "monthly"));
    input.yearlyPriceCents = dollarsToCents(text(f, "yearly"));
    if (!Number.isFinite(input.monthlyPriceCents) || !Number.isFinite(input.yearlyPriceCents)) throw new AdminError("invalid", "Enter the prices in dollars, for example 49 or 49.50.");
  }
  return input;
}

/** Create or edit. A price change on an existing plan first answers with the confirm step; the same form then re-submits with confirmPrice=1. */
export async function savePlanAction(_prev: PlanFormState, f: FormData): Promise<PlanFormState> {
  const ctx = await adminAction("plans.manage");
  const mode = text(f, "mode");
  let destination: string;
  try {
    if (mode === "create") {
      const input = readForm(f, false);
      const result = await createPlan(ctx, { ...(input as PlanInput), key: text(f, "key") });
      const note =
        result.paddle === "synced" ? "Plan created and its prices are in Paddle."
        : result.paddle === "not_connected" ? "Plan saved as a draft. Paddle is not connected, so it has no prices there yet."
        : `Plan saved as a draft, but Paddle failed: ${result.paddleError}`;
      destination = `/admin/plans/${encodeURIComponent(result.plan.key)}?${result.paddle === "failed" ? "error" : "notice"}=${encodeURIComponent(note)}`;
    } else {
      const key = text(f, "key");
      const current = await getPlan(key);
      if (!current) throw new AdminError("not_found", "No plan with that key.");
      const input = readForm(f, current.isTrial, !current.isCustom && current.currency === "USD");
      const priceChanged = !current.isTrial && input.monthlyPriceCents !== undefined && (input.monthlyPriceCents !== current.monthlyPriceCents || input.yearlyPriceCents !== current.yearlyPriceCents);
      if (priceChanged && text(f, "confirmPrice") !== "1") {
        const preview = await previewPriceChange(key, { monthlyPriceCents: input.monthlyPriceCents!, yearlyPriceCents: input.yearlyPriceCents! });
        return { confirm: { lines: preview.lines, direction: preview.direction, affected: preview.affected, monthlyCents: input.monthlyPriceCents!, yearlyCents: input.yearlyPriceCents! } };
      }
      // Only the price the admin was shown can be confirmed.
      if (priceChanged && (text(f, "previewMonthly") !== String(input.monthlyPriceCents) || text(f, "previewYearly") !== String(input.yearlyPriceCents))) {
        throw new AdminError("conflict", "The price is not the one you reviewed. Review the price change again.");
      }
      const result = await updatePlan(ctx, key, input, { confirmPriceChange: priceChanged && text(f, "confirmPrice") === "1", expectedVersion: text(f, "version") || undefined });
      const parts = [result.changed.length === 0 ? "Nothing to change." : "Plan saved."];
      if (result.priceChange) parts.push(`${result.priceChange.subscribers} ${result.priceChange.subscribers === 1 ? "client" : "clients"} will be moved to the new price.`);
      parts.push(...result.warnings);
      destination = `/admin/plans/${encodeURIComponent(key)}?notice=${encodeURIComponent(parts.join(" "))}`;
    }
  } catch (e) {
    return { error: actionMessage(e) };
  }
  revalidatePath("/admin/plans");
  redirect(destination);
}

export async function syncPlanAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  const key = text(f, "key");
  await finish(`/admin/plans/${encodeURIComponent(key)}`, "Synced with Paddle.", () => syncPlanToPaddle(ctx, key));
}

export async function retirePlanAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  const key = text(f, "key");
  const status = text(f, "status") as PlanStatus;
  await finish(`/admin/plans/${encodeURIComponent(key)}`, status === "retired" ? "Plan retired. Existing clients stay on it." : `Plan is now ${status}.`, () => updatePlan(ctx, key, { status }));
}

export async function cancelPriceChangeAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  const key = text(f, "key");
  await finish(`/admin/plans/${encodeURIComponent(key)}`, "Price change stopped. Clients not yet moved keep their price.", () => cancelPriceChange(ctx, text(f, "id")));
}

export async function retryPriceChangeAction(f: FormData) {
  const ctx = await adminAction("plans.manage");
  const key = text(f, "key");
  await finish(`/admin/plans/${encodeURIComponent(key)}`, "Queued again. The next run picks them up.", () => retryFailedPriceItems(ctx, text(f, "id")));
}
