import "server-only";
import { prisma } from "@/lib/db";

export type RateLimitRule = { limit: number; windowSeconds: number };

/** Limits for actions that are free to the user but cost storage or compute. Per user. */
export const RATE_LIMITS = {
  templateDesign: { limit: 60, windowSeconds: 60 * 60 }, // 60 template designs an hour
  aiImage: { limit: 10, windowSeconds: 60 * 60 }, // paid Gemini images (describe an image, AI photo): 10 an hour
  designPreview: { limit: 400, windowSeconds: 60 * 60 },
  photoUpload: { limit: 60, windowSeconds: 60 * 60 },
  projectCreate: { limit: 30, windowSeconds: 60 * 60 }, // new products and campaigns (and the legacy /api/generate), together
  knowledgeEdit: { limit: 300, windowSeconds: 60 * 60 }, // product / campaign saves, status changes, copies, deletes, album edits
  profileSave: { limit: 60, windowSeconds: 60 * 60 }, // Knowledge base -> Company profile
  knowledgeCreate: { limit: 120, windowSeconds: 60 * 60 }, // new personas, competitors, FAQs and reviews, together
  interviewStep: { limit: 300, windowSeconds: 60 * 60 }, // marketing interview answers, skips, back, start, approve
  interviewAi: { limit: 60, windowSeconds: 60 * 60 }, // marketing interview AI calls (next question, summary), per company
  contentEdit: { limit: 120, windowSeconds: 60 * 60 },
  contentRegenerate: { limit: 60, windowSeconds: 60 * 60 }, // "Generate again" on one post or piece, per company (each also uses a text generation)
  videoDesign: { limit: 30, windowSeconds: 60 * 60 },
  videoVoice: { limit: 30, windowSeconds: 60 * 60 }, // Video Studio designs (Claude), per company; each also uses video credits
  canvaOpen: { limit: 20, windowSeconds: 60 * 60 },
  canvaReturn: { limit: 30, windowSeconds: 60 * 60 },
  socialConnect: { limit: 30, windowSeconds: 60 * 60 }, // starting a social connection (OAuth or BuPulse-Socials)
  storeConnect: { limit: 30, windowSeconds: 60 * 60 }, // starting a Shopify/WooCommerce/Cloudflare connection
  storeImport: { limit: 150, windowSeconds: 60 * 60 }, // import/list calls (5 products each)
  momo: { limit: 10, windowSeconds: 60 * 60 }, // Mobile Money start / "I've paid" / cancel, together, per company
  momoProof: { limit: 20, windowSeconds: 60 * 60 }, // Mobile Money screenshot upload URLs, per user
  invoicePdf: { limit: 60, windowSeconds: 60 * 60 },
  planRequest: { limit: 3, windowSeconds: 24 * 60 * 60 }, // custom plan requests (each emails the owner), per company per day
  offerAccept: { limit: 20, windowSeconds: 60 * 60 }, // accepting an offer / choosing how to pay it, per company // invoice PDF downloads (drawn on demand when not stored), per company
  placesAutocomplete: { limit: 300, windowSeconds: 60 * 60 }, // address suggestions (debounced typing), per company
  geoCountry: { limit: 20, windowSeconds: 60 * 60 }, // "Use my location" on the pricing page (a Google Geocoding call), per IP
  placesDetails: { limit: 60, windowSeconds: 60 * 60 }, // the chosen address's details, per company
  videoRobot: { limit: 120, windowSeconds: 60 * 60 }, // video robot API calls (a run makes about 10), per IP
  pushDevice: { limit: 20, windowSeconds: 60 * 60 }, // "Alerts on this device" switched on (per person)
  firstPostPreview: { limit: 6, windowSeconds: 60 * 60 }, // the free first-post preview button (at most 2 AI calls ever), per company
  whatsappShare: { limit: 200, windowSeconds: 60 * 60 }, // "Share to WhatsApp" counted (a product event each), per company; more are not counted
} satisfies Record<string, RateLimitRule>;

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many requests");
  }
}

/**
 * Counts one hit for `key` in the current fixed window and throws RateLimitError when the limit is
 * exceeded. One atomic upsert-increment, so parallel requests can't slip past the limit.
 */
export async function rateLimit(key: string, rule: RateLimitRule, now = new Date()): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > rule.limit) {
    throw new RateLimitError(Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
  }
}

/** Friendly text for a RateLimitError. */
export function rateLimitMessage(error: RateLimitError) {
  const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
  return `You're doing that a lot. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** Old windows are useless after they end; the daily purge job may call this. */
export async function pruneRateLimits(olderThan = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)) {
  await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: olderThan } } });
}
