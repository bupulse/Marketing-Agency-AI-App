import type { BadgeTone } from "@/components/ui";

/** Badge colour of an offer status in the admin lists. */
export const OFFER_TONE: Record<string, BadgeTone> = { draft: "neutral", sent: "violet", accepted: "blue", paid: "success", expired: "neutral", withdrawn: "neutral" };
