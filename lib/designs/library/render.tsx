// Draws a design of the library (lib/designs/library/catalog.ts) with next/og: the same engine, fonts and limits as
// the classic templates (lib/designs/templates). Free: no AI is involved.
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { defaultKicker } from "@/lib/designs/labels";
import { ASPECT_SIZES, orientationOf, type AspectRatio } from "@/lib/designs/layout";
import { loadFonts } from "@/lib/designs/templates/fonts";
import type { TemplateId } from "@/lib/designs/templates/registry";
import { getDesign, type FamilyId } from "./catalog";
import { circle, diagonal, hero, magazine, polaroid, split } from "./families/photo";
import { banner, features, minimal, poster, price, quote, steps, testimonial } from "./families/text";
import { makeCtx, type Ctx, type DesignInput } from "./kit";

const FAMILY_LAYOUTS: Record<FamilyId, (c: Ctx) => ReactElement> = { hero, split, polaroid, circle, diagonal, magazine, price, steps, quote, testimonial, features, poster, banner, minimal };

export type DesignOptions = {
  /** The template the art director chose, for the default kicker text ("New arrival") when the slide has none. */
  template?: TemplateId | null;
};

function kickerFor(input: DesignInput, options: DesignOptions): string {
  if (input.kicker !== undefined && input.kicker !== null) return input.kicker;
  return options.template ? defaultKicker(options.template, input.language) : "";
}

/** The element tree for a design, without rendering (used by tests). Throws for an unknown id. */
export function buildDesignElement(id: string, input: DesignInput, ratio: AspectRatio, options: DesignOptions = {}): ReactElement {
  const design = getDesign(id);
  if (!design) throw new Error(`Unknown design "${id}"`);
  const size = ASPECT_SIZES[ratio];
  return FAMILY_LAYOUTS[design.family](makeCtx(design, input, ratio, size, orientationOf(ratio), kickerFor(input, options)));
}

/** Renders a design to PNG bytes. */
export async function renderDesign(id: string, input: DesignInput, ratio: AspectRatio, options: DesignOptions = {}): Promise<ArrayBuffer> {
  const element = buildDesignElement(id, input, ratio, options);
  const design = getDesign(id)!;
  const { width, height } = ASPECT_SIZES[ratio];
  const text = [input.businessName, input.headline, input.subline, input.chip, kickerFor(input, options), input.step ? String(input.step) : ""].filter(Boolean).join(" ");
  const fonts = await loadFonts(text, design.style);
  const response = new ImageResponse(element, { width, height, ...(fonts.length ? { fonts } : {}) });
  return response.arrayBuffer();
}
