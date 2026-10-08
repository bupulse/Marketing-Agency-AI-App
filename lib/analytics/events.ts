import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { cleanSessionId } from "./collect";

/** Product events the roll-up knows. Anything else is stored too, but only these feed the funnel and feature adoption. */
export const EVENT_NAMES = {
  signup: "signup",
  trialStarted: "trial_started",
  onboardingStep: "onboarding_step", // props.step: "offer" | "voice" | "look" | "knowledge"
  onboardingComplete: "onboarding_complete",
  textGenerated: "text_generated",
  imageGenerated: "image_generated",
  designCreated: "design_created",
  postScheduled: "post_scheduled",
  postPublished: "post_published",
  leadCaptured: "lead_captured",
  upgrade: "upgrade", // props.plan, props.interval
  planChange: "plan_change", // a paying customer switched plan or interval (not a new customer)
  cancel: "cancel",
} as const;

export type TrackOptions = {
  userId?: string | null;
  businessId?: string | null;
  /** The anonymous visit session from the tracker (sessionStorage), set on signup to link the visit. */
  sessionId?: string | null;
  props?: Record<string, string | number | boolean | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records a product event. Fire-and-forget: returns immediately, never throws, never rejects, and the write keeps
 * running after the response on Workers (waitUntil). A failed write is only logged to the console.
 */
export function trackEvent(name: string, options: TrackOptions = {}): void {
  try {
    const promise = Promise.resolve()
      .then(() =>
        prisma.analyticsEvent.create({
          data: {
            name: String(name).slice(0, 60),
            userId: options.userId && UUID.test(options.userId) ? options.userId : null,
            businessId: options.businessId ? String(options.businessId).slice(0, 40) : null,
            sessionId: cleanSessionId(options.sessionId),
            props: options.props ? (options.props as Prisma.InputJsonValue) : undefined,
          },
        }),
      )
      .catch((error) => console.error(`[analytics] trackEvent ${name} failed:`, error instanceof Error ? error.message : error));
    try {
      getCloudflareContext().ctx.waitUntil(promise);
    } catch {
      // Not on Workers (local dev, tests, next start): the promise simply keeps running.
    }
  } catch (error) {
    console.error(`[analytics] trackEvent ${name} failed:`, error instanceof Error ? error.message : error);
  }
}
