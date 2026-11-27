import "server-only";
import { displayRegion } from "@/lib/region";
import { getWaitlist } from "@/lib/waitlist-server";
import { ctaModeForRegion, type CtaMode } from "./cta";

/**
 * The call to action for this request's visitor: their display region (lib/region.ts, the same one the pricing page
 * shows), "quote" for Rwanda. It reads the request's headers and cookies, so the pages that use it render per request.
 * No try/catch on purpose: Next.js learns that a page is dynamic from the error headers() throws while prerendering,
 * and displayRegion already falls back (cached regions, then the seeds) when the database cannot be read.
 */
export async function visitorCtaMode(): Promise<CtaMode> {
  // While the waiting list is on (lib/waitlist.ts) every visitor, in any country, gets the quote form, never the trial.
  if (await getWaitlist()) return "quote";
  return ctaModeForRegion((await displayRegion()).key);
}
