"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { featureBlocked } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { orderExtraSkit, SkitError } from "@/lib/skits/service";
import { ForbiddenError } from "@/lib/team/roles";

/** "Order an extra skit — 5,000 RWF": a request BuPulse confirms by phone (no payment in the app yet). */
export async function orderExtraSkitAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("content", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
  const blocked = await featureBlocked(user.businessId, "video");
  if (blocked) return { ok: false, error: blocked };
  try {
    await rateLimit(`skit-order:${user.businessId}`, { limit: 5, windowSeconds: 60 * 60 });
    await orderExtraSkit({ userId: user.id, businessId: user.businessId });
  } catch (error) {
    if (error instanceof SkitError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    await logError(error, { source: "skits.order", businessId: user.businessId });
    return { ok: false, error: "We could not send the order. Try again." };
  }
  revalidatePath("/dashboard/content");
  return { ok: true };
}
