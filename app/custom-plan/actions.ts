"use server";

import { requireActiveUser } from "@/lib/auth/require-user";
import { companyEntitlements } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { createPlanRequest, PlanRequestError } from "@/lib/offers/requests";
import { RateLimitError } from "@/lib/rate-limit";

export type RequestState = { error?: string; done?: boolean };

/**
 * "Request a custom plan" (docs/OFFERS.md): owner (billing permission) only, rate-limited per company. The owner of
 * BuPulse is emailed; the request shows in Admin -> Plan requests, linked to the company and its demo booking.
 */
export async function requestCustomPlanAction(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const user = await requireActiveUser("billing");
  if (!user.email_confirmed_at) return { error: "Confirm your email address first, then send your request." };
  const raw = {
    description: String(formData.get("description") ?? ""),
    features: formData.getAll("features").map(String),
    budget: String(formData.get("budget") ?? "") || null,
    phone: String(formData.get("phone") ?? "") || null,
    source: String(formData.get("source") ?? "billing"),
  };
  try {
    // What the plan already has is ticked and locked on the form; only the features on top of it are the request.
    const owned = user.businessId ? [...(await companyEntitlements(user.businessId)).inPlan] : [];
    await createPlanRequest({ userId: user.id, actorId: user.actorId, businessId: user.businessId, raw, owned });
    return { done: true };
  } catch (error) {
    if (error instanceof PlanRequestError) return { error: error.message };
    if (error instanceof RateLimitError) return { error: "You have sent a few requests today already. We will be in touch; you can also reply to our emails." };
    await logError(error, { source: "offers.request", businessId: user.businessId });
    return { error: "Something went wrong. Nothing was sent. Please try again." };
  }
}
