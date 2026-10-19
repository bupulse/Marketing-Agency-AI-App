"use server";

import { requireActiveUser } from "@/lib/auth/require-user";
import { logError } from "@/lib/errors";
import { makeFirstPostPreview, PreviewError, type PreviewView } from "@/lib/preview/first-post";
import { RATE_LIMITS, rateLimit, RateLimitError, rateLimitMessage } from "@/lib/rate-limit";

export type FirstPostResult = { ok: true; preview: PreviewView } | { ok: false; error: string };

/**
 * "Make my first post" on the demo screen (components/app/first-post-preview.tsx). The Owner or an Admin of a company
 * waiting for its demo; the service checks the switch, the state and the one-per-company rule (lib/preview/first-post.ts).
 */
export async function makeFirstPostAction(): Promise<FirstPostResult> {
  const user = await requireActiveUser("settings");
  try {
    await rateLimit(`first-post:${user.businessId}`, RATE_LIMITS.firstPostPreview);
    return { ok: true, preview: await makeFirstPostPreview({ userId: user.id, businessId: user.businessId }) };
  } catch (e) {
    if (e instanceof PreviewError) return { ok: false, error: e.message };
    if (e instanceof RateLimitError) return { ok: false, error: rateLimitMessage(e) };
    await logError(e, { source: "preview.first_post.action", businessId: user.businessId });
    return { ok: false, error: "We could not make your post just now. Please try again in a moment." };
  }
}
