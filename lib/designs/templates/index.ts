import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { defaultKicker } from "@/lib/designs/labels";
import type { PackId } from "@/lib/designs/packs";
import { ASPECT_SIZES, buildTheme, orientationOf, type AspectRatio, type TemplateInput } from "@/lib/designs/layout";
import { announcement } from "./announcement";
import { event } from "./event";
import { loadFonts } from "./fonts";
import { classicPack } from "./packs";
import { justListed } from "./just-listed";
import { newArrival } from "./new-arrival";
import { offer } from "./offer";
import { projectDone } from "./project-done";
import { quote } from "./quote";
import { isTemplateId, TEMPLATES, type TemplateId } from "./registry";
import type { LayoutProps } from "./shared";

export { TEMPLATES, isTemplateId, templatesForProjectType, type TemplateId, type TemplateInfo } from "./registry";

const DEFAULT_PACK: PackId = "clean";

const LAYOUTS: Record<TemplateId, (props: LayoutProps) => ReactElement> = {
  "new-arrival": newArrival,
  offer,
  event,
  "just-listed": justListed,
  "project-done": projectDone,
  quote,
  announcement,
};

/** The element tree for a template, without rendering (used by tests). */
export function buildTemplateElement(id: string, input: TemplateInput, ratio: AspectRatio): ReactElement {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template || !isTemplateId(id)) throw new Error(`Unknown template "${id}"`);
  const { width, height } = ASPECT_SIZES[ratio];
  return LAYOUTS[id]({
    input,
    ratio,
    width,
    height,
    orientation: orientationOf(ratio),
    theme: buildTheme(input.colors),
    kicker: input.kicker ?? defaultKicker(template.id, input.language),
    pack: input.pack ?? DEFAULT_PACK,
  });
}

/** Renders a template to PNG bytes. Free and unlimited: no AI is involved. */
export async function renderTemplate(id: string, input: TemplateInput, ratio: AspectRatio): Promise<ArrayBuffer> {
  const element = buildTemplateElement(id, input, ratio);
  const { width, height } = ASPECT_SIZES[ratio];
  const text = [input.businessName, input.headline, input.subline, input.chip, input.kicker, defaultKicker(isTemplateId(id) ? id : "offer", input.language)].filter(Boolean).join(" ");
  const fonts = await loadFonts(text, classicPack(input.pack ?? DEFAULT_PACK));
  const response = new ImageResponse(element, { width, height, ...(fonts.length ? { fonts } : {}) });
  return response.arrayBuffer();
}
