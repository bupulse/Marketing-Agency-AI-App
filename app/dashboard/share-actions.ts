"use server";

import { requireActiveUser } from "@/lib/auth/require-user";
import { EVENT_NAMES, trackEvent } from "@/lib/analytics/events";
import { RATE_LIMITS, RateLimitError, rateLimit } from "@/lib/rate-limit";

// "Share to WhatsApp" (components/share/whatsapp-share.tsx) counts each share as a product event (AnalyticsEvent
// "whatsapp_share"), so the admin sees how much clients use it. Counting never gets in the way of the share itself.

export async function recordWhatsAppShare(what: unknown, how: unknown): Promise<void> {
  try {
    const user = await requireActiveUser(undefined, "throw");
    if (!user.businessId) return;
    // A share is one tap; a few hundred an hour is not a person, and is not counted.
    await rateLimit(`whatsapp-share:${user.businessId}`, RATE_LIMITS.whatsappShare);
    await trackEvent(EVENT_NAMES.whatsappShare, {
      userId: user.actorId,
      businessId: user.businessId,
      props: { what: what === "video" ? "video" : "post", how: how === "download" ? "download" : "share" },
    });
  } catch (error) {
    // redirect() (signed out) and the rate limit end here quietly: the share already happened.
    if (error instanceof RateLimitError) return;
    if (error instanceof Error && "digest" in error) return;
    console.error("[share] could not count a WhatsApp share:", error instanceof Error ? error.message : error);
  }
}
