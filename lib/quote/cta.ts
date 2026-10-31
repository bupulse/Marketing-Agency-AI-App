import { RWANDA_REGION_KEY } from "@/lib/region-format";

// Which call to action the marketing site shows (the owner's decision of 31 Oct 2026): visitors in the Rwanda price
// region get "Get a free quote" (a pop-up form; BuPulse calls them back) and no free-trial link at all; every other
// region keeps "Start your free trial". The region is the one the pricing page shows (lib/region.ts displayRegion:
// the "Use my location" cookie, else the host's IP country). /start-trial itself still works for direct links. Pure.

export type CtaMode = "quote" | "trial";

export const QUOTE_LABEL = "Get a free quote";

export function ctaModeForRegion(regionKey: string | null | undefined): CtaMode {
  return (regionKey ?? "").toUpperCase() === RWANDA_REGION_KEY ? "quote" : "trial";
}
