// The application page /c/<slug> in the company's colours (docs/CREATOR_CAMPAIGN_WIZARD.md, "Branding"). Pure. Brand
// has colours (Business.brandColors) and a logo but no font yet, so the page keeps BuPulse's font.

import { contrastRatio, isHexColor, PULSE_BLUE, PULSE_VIOLET, readableTextColor } from "@/lib/color-contrast";

export type BrandLook = { brand: string; brand2: string; onBrand: string };

/**
 * The first brand colour fills buttons and picked answers, with text readable on it (WCAG AA); the second tints the
 * top of the page. Without brand colours the page keeps BuPulse's own blue, white text, like every BuPulse button.
 */
export function brandLook(colors: string[]): BrandLook {
  const hexes = colors.filter(isHexColor);
  if (!hexes.length) return { brand: PULSE_BLUE, brand2: PULSE_VIOLET, onBrand: "#FFFFFF" };
  const brand = hexes[0];
  const brand2 = hexes.find((c) => c.toLowerCase() !== brand.toLowerCase()) ?? brand;
  const text = readableTextColor(brand);
  return { brand, brand2, onBrand: contrastRatio(text, brand) >= 4.5 ? text : "#000000" };
}

/** The look as CSS variables for the page's wrapper. */
export function brandVars(look: BrandLook): Record<string, string> {
  return { "--brand": look.brand, "--brand-2": look.brand2, "--on-brand": look.onBrand };
}
