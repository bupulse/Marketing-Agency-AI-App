"use server";

import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";
import { bookDemo, choosePlan, DemoError } from "@/lib/demo/bookings";
import { logError } from "@/lib/errors";
import { rateLimit, rateLimitMessage, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";

export type BookDemoState = { error?: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

// Server actions are public POST endpoints: a few tries an hour per company is plenty for a person and stops a loop
// from spamming the owner with invites (each booking emails every admin address).
export const DEMO_LIMITS = {
  choose: { limit: 10, windowSeconds: 60 * 60 },
  book: { limit: 5, windowSeconds: 60 * 60 },
  cancel: { limit: 5, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

/** The rate limit for a demo action, as the message to answer with, or null to go on. */
export async function demoLimited(businessId: string, kind: keyof typeof DEMO_LIMITS): Promise<string | null> {
  try {
    await rateLimit(`demo:${kind}:${businessId}`, DEMO_LIMITS[kind]);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitMessage(error);
    throw error;
  }
}

/** Step 1: the plan to try. Owner or admin only; the service checks the plan is offered in the company's region. */
export async function choosePlanAction(_prev: BookDemoState, formData: FormData): Promise<BookDemoState> {
  const user = await requireActiveUser("settings");
  const limited = await demoLimited(user.businessId, "choose");
  if (limited) return { error: limited };
  try {
    await choosePlan({ businessId: user.businessId, planKey: String(formData.get("plan") ?? "") });
  } catch (error) {
    if (error instanceof DemoError) return { error: error.message };
    await logError(error, { source: "demo.choose-plan", businessId: user.businessId });
    return { error: GENERIC };
  }
  redirect("/book-demo?step=time");
}

/** Step 2: a free slot (or a new one for the live booking). */
export async function bookDemoAction(_prev: BookDemoState, formData: FormData): Promise<BookDemoState> {
  const user = await requireActiveUser("settings");
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));
  if (Number.isNaN(startsAt.getTime())) return { error: "Pick a time from the list." };
  const limited = await demoLimited(user.businessId, "book");
  if (limited) return { error: limited };
  try {
    await bookDemo({ businessId: user.businessId, startsAt });
  } catch (error) {
    if (error instanceof DemoError) return { error: error.message };
    await logError(error, { source: "demo.book", businessId: user.businessId });
    return { error: GENERIC };
  }
  redirect("/dashboard?demo=booked");
}
