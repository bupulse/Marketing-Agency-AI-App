"use server";

import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";
import { bookDemo, choosePlan, DemoError } from "@/lib/demo/bookings";
import { logError } from "@/lib/errors";

export type BookDemoState = { error?: string };

const GENERIC = "Something went wrong. Nothing was changed. Please try again.";

/** Step 1: the plan to try. Owner or admin only; the service checks the plan is offered in the company's region. */
export async function choosePlanAction(_prev: BookDemoState, formData: FormData): Promise<BookDemoState> {
  const user = await requireActiveUser("settings");
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
  try {
    await bookDemo({ businessId: user.businessId, startsAt });
  } catch (error) {
    if (error instanceof DemoError) return { error: error.message };
    await logError(error, { source: "demo.book", businessId: user.businessId });
    return { error: GENERIC };
  }
  redirect("/dashboard?demo=booked");
}
