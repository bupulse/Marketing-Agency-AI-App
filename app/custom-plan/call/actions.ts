"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";
import { DemoError } from "@/lib/demo/bookings";
import { demoLimited } from "@/lib/demo/limits";
import { bookPlanCall, cancelPlanCall } from "@/lib/demo/plan-calls";
import { logError } from "@/lib/errors";
import { publicLimited } from "@/lib/request-limits";

export type PlanCallState = { error?: string };
export type PlanCallResult = { ok: true } | { ok: false; error: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/**
 * The call about a custom plan request (lib/demo/plan-calls.ts): a free slot, or a new one for the live call. The owner
 * (billing permission, like the request itself) with a confirmed email; the same rate limits demo bookings had.
 */
export async function bookPlanCallAction(_prev: PlanCallState, formData: FormData): Promise<PlanCallState> {
  const user = await requireActiveUser("billing");
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));
  if (Number.isNaN(startsAt.getTime())) return { error: "Pick a time from the list." };
  if (!user.email_confirmed_at) return { error: "Confirm your email address first, then book your call." };
  const limited = (await demoLimited(user.businessId, "book")) ?? (await publicLimited("demoBook"));
  if (limited) return { error: limited };
  let moved = false;
  try {
    moved = (await bookPlanCall({ businessId: user.businessId, startsAt, requestId: String(formData.get("request") ?? "") || null })).rescheduled;
  } catch (error) {
    if (error instanceof DemoError) return { error: error.message };
    await logError(error, { source: "plan-call.book", businessId: user.businessId });
    return { error: GENERIC };
  }
  redirect(`/custom-plan/call?${moved ? "moved" : "booked"}=1`);
}

/** Cancels the live call (owner, at least 2 hours ahead). */
export async function cancelPlanCallAction(): Promise<PlanCallResult> {
  const user = await requireActiveUser("billing", "throw").catch(() => null);
  if (!user) return { ok: false, error: "Ask your company owner to do this." };
  const limited = await demoLimited(user.businessId, "cancel");
  if (limited) return { ok: false, error: limited };
  try {
    await cancelPlanCall({ businessId: user.businessId });
  } catch (error) {
    if (error instanceof DemoError) return { ok: false, error: error.message };
    await logError(error, { source: "plan-call.cancel", businessId: user.businessId });
    return { ok: false, error: "We could not cancel the call. Please try again." };
  }
  revalidatePath("/custom-plan/call");
  revalidatePath("/dashboard/billing");
  return { ok: true };
}
