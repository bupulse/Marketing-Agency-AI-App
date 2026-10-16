"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { demoLimited } from "@/lib/demo/limits";
import { cancelDemo, DemoError } from "@/lib/demo/bookings";
import { logError } from "@/lib/errors";

export type DemoActionResult = { ok: true } | { ok: false; error: string };

/** Cancels the company's live demo booking (owner or admin, at least 2 hours ahead). */
export async function cancelDemoAction(): Promise<DemoActionResult> {
  const user = await requireActiveUser("settings", "throw").catch(() => null);
  if (!user) return { ok: false, error: "Ask your company owner to do this." };
  const limited = await demoLimited(user.businessId, "cancel");
  if (limited) return { ok: false, error: limited };
  try {
    await cancelDemo({ businessId: user.businessId });
  } catch (error) {
    if (error instanceof DemoError) return { ok: false, error: error.message };
    await logError(error, { source: "demo.cancel", businessId: user.businessId });
    return { ok: false, error: "We could not cancel the demo. Please try again." };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
