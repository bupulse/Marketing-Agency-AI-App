// Which design of the library (lib/designs/library) each slide gets, and which video look a video gets. BuPulse
// chooses, never the owner: the art director's template says what the slide is about, the catalogue's chooser picks a
// design that fits it and that the business has not used recently. Pure, so it is unit tested.
import { chooseDesign, getDesign, type Angle } from "@/lib/designs/library/catalog";
import type { TemplateId } from "@/lib/designs/templates/registry";
import type { ImagePlan, VisualSlide } from "./types";
import { chooseVideoLook, type VideoAngle } from "./video-looks";

const TEMPLATE_ANGLE: Record<TemplateId, Angle> = {
  "new-arrival": "new",
  offer: "offer",
  event: "event",
  "just-listed": "listing",
  "project-done": "showcase",
  quote: "quote",
  announcement: "announcement",
};

/** What a slide is about: its template, a price on an offer, or a tip when it is a text slide inside a carousel. */
export function slideAngle(slide: Pick<VisualSlide, "template" | "chip" | "source">, index: number, count: number): Angle {
  if (slide.template === "offer" && /\d/.test(slide.chip)) return "price";
  if (count > 1 && index > 0 && slide.template === "announcement" && slide.source === "text") return "tips";
  return TEMPLATE_ANGLE[slide.template] ?? "general";
}

/** Whether a slide will be drawn with a photo (its album photo or a paid or planned AI photo). */
export function slideHasPhoto(slide: Pick<VisualSlide, "source" | "photoPath" | "aiPhotoPath" | "useCoverPhoto">): boolean {
  return slide.source === "ai" || !!slide.aiPhotoPath || !!slide.useCoverPhoto || (slide.source === "album" && !!slide.photoPath);
}

/**
 * Gives every slide (or only the slides in `only`) a design of the plan's style. Each slide avoids the business's
 * recent designs and the designs of the other slides, so a carousel changes layout from slide to slide. Tips slides
 * are numbered in order.
 */
export function assignDesigns(plan: ImagePlan, options: { recent: readonly string[]; seed: string; only?: Set<number> }): ImagePlan {
  const count = plan.slides.length;
  const only = options.only;
  // Slides that keep their design still count, so a redrawn slide does not copy its neighbour.
  const taken: string[] = only ? plan.slides.flatMap((s, i) => (s.design && !only.has(i) ? [s.design] : [])) : [];
  let tip = 0;
  const slides = plan.slides.map((slide, i) => {
    const angle = slideAngle(slide, i, count);
    if (angle === "tips") tip += 1;
    if (only && !only.has(i)) return slide;
    const design = chooseDesign({
      style: plan.pack,
      angle,
      aspect: plan.aspectRatio,
      hasPhoto: slideHasPhoto(slide),
      textLength: slide.headline.length + slide.subline.length,
      recent: [...taken.slice().reverse(), ...options.recent],
      seed: `${options.seed}#${i}`,
    });
    taken.push(design);
    return { ...slide, design, ...(angle === "tips" ? { step: tip } : {}) };
  });
  return { ...plan, slides };
}

/** The slide's design when it has one of this style that can still be drawn; a photo design without a photo is not. */
export function usableDesign(slide: Pick<VisualSlide, "design">, pack: ImagePlan["pack"], hasPhoto: boolean): string | null {
  const d = slide.design ? getDesign(slide.design) : null;
  if (!d || d.style !== pack) return null;
  return d.needsPhoto && !hasPhoto ? null : d.id;
}

const VIDEO_ANGLE: Record<TemplateId, VideoAngle> = {
  "new-arrival": "promo",
  offer: "promo",
  event: "event",
  "just-listed": "promo",
  "project-done": "story",
  quote: "testimonial",
  announcement: "announcement",
};

/** The video look for a video plan, from the image plan's style and first template (when there is one). */
export function chooseLook(input: { pack: ImagePlan["pack"]; template?: TemplateId | null; tips?: boolean; hasPhoto: boolean; recent: readonly string[]; seed: string }): string {
  const angle: VideoAngle = input.tips ? "tips" : input.template ? VIDEO_ANGLE[input.template] : "promo";
  return chooseVideoLook({ style: input.pack, angle, hasPhoto: input.hasPhoto, recent: input.recent, seed: input.seed });
}

/** Design ids and video look ids in stored plans (newest first), for "do not repeat recent designs". */
export function recentChoices(plans: unknown[]): { designs: string[]; looks: string[] } {
  const designs: string[] = [];
  const looks: string[] = [];
  for (const plan of plans) {
    if (!plan || typeof plan !== "object") continue;
    const p = plan as { slides?: unknown; look?: unknown };
    if (typeof p.look === "string") looks.push(p.look);
    if (Array.isArray(p.slides)) for (const s of p.slides) if (s && typeof s === "object" && typeof (s as { design?: unknown }).design === "string") designs.push((s as { design: string }).design);
  }
  return { designs, looks };
}
