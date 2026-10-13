// The art director's rules: what the AI may choose for a visual, how its answer is checked, and the plan BuPulse
// falls back to when the answer is unusable or AI is not allowed. Pure (no I/O), so it is unit tested; the AI call
// itself is lib/visuals/art-director.ts.
import { z } from "zod";
import { isPackId, PACKS, recommendPack, type PackId } from "@/lib/designs/packs";
import { isTemplateId, TEMPLATES, templatesForProjectType, type TemplateId } from "@/lib/designs/templates/registry";
import { defaultPeople, peopleSchema, peopleScene, readPeople, type Audience, type PeopleBrief } from "./people";
import { VISUAL_LIMITS, type ImagePlan, type SlideSource, type VisualSlide } from "./types";

/** Templates built around a photo; without one they become the plain announcement layout. */
export const PHOTO_TEMPLATES: TemplateId[] = ["new-arrival", "just-listed", "project-done"];

// ---- what the AI returns ----

const slideSchema = z.object({
  headline: z.string().describe(`The big text on the slide, at most ${VISUAL_LIMITS.headline} characters, from the content, in the content language`),
  subline: z.string().describe(`One short supporting line, at most ${VISUAL_LIMITS.subline} characters; empty for none`),
  chip: z.string().describe(`A price, date or call to action exactly as written in the content or facts, at most ${VISUAL_LIMITS.chip} characters; empty for none`),
  kicker: z.string().describe(`A 1 to 3 word label above the headline; empty for none`),
  template: z.string().describe(`One of: ${TEMPLATES.map((t) => t.id).join(", ")}`),
  image: z.enum(["album", "ai", "none"]).describe("ai: a realistic photo with people (the default for the cover); album: one of the owner's photos as it is; none: a designed slide (tips, prices, quotes)"),
  photo: z.number().int().describe("The album photo to use (0 is the first): shown as it is for image=album, or the product reference for image=ai; -1 for none"),
  scene: z.string().describe("For image=ai: what is photographed besides the people (product, props, place), in English, no prices; empty otherwise"),
});

export const directionSchema = z.object({
  format: z.enum(["single", "carousel"]),
  pack: z.string().describe(`One of: ${PACKS.map((p) => p.id).join(", ")}`),
  slides: z.array(slideSchema).min(1),
  people: peopleSchema.describe("The people in the AI photo: everyday local customers or staff, in English"),
});

export type Direction = z.infer<typeof directionSchema>;

const json = z.toJSONSchema(directionSchema) as Record<string, unknown>;
delete json.$schema;
export const DIRECTION_JSON_SCHEMA = json;

// ---- what the art director knows ----

export interface DirectionContext {
  /** The old project type of the product or campaign ("product", "offer", "event"...), for template choice. */
  subjectType: string;
  title: string;
  /** The price label as the owner entered it, if any. */
  price?: string | null;
  caption: string;
  headlines: string[];
  business: { name: string; tone?: string | null; industry?: string | null };
  /** Album photos, cover first. Only JPG and PNG can be drawn in a template. */
  photos: { path: string; mimeType?: string | null }[];
  /** Whether one of the target networks publishes carousels. */
  carouselAllowed: boolean;
  /** AI photos may be made (aiPhotos feature, image credits and the company's AI allowance all left). */
  aiAllowed: boolean;
  /** Most AI photos this visual may use. */
  maxAi?: number;
  /** Most slides (Autopilot uses fewer). */
  maxSlides?: number;
  /** The company's country and personas, so the people in AI photos look like its customers. */
  audience?: Audience;
}

const FENCE = /<{3,}|>{3,}/;

/** Text the owner or the AI wrote, made safe for a slide: one line, no fences or control characters, clipped. */
export function slideText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  while (FENCE.test(text)) text = text.replace(new RegExp(FENCE, "g"), "");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > max / 2 ? room.slice(0, space) : room).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** The numbers in a text, thousands separators removed: "RWF 45,000 or 2 for 80 000" is 45000, 2, 80000. */
const numbers = (s: string) => (s.match(/\d(?:[\d,.\s]*\d)?/g) ?? []).map((n) => n.replace(/[,.\s]/g, ""));

/**
 * A chip may only say numbers that the owner's content says too: prices, discounts and dates are never invented.
 * Words-only chips ("Book now") are kept.
 */
export function chipAllowed(chip: string, sources: string[]): boolean {
  const known = new Set(sources.flatMap(numbers));
  return numbers(chip).every((n) => known.has(n));
}

/** Lines of the caption that read like a list (numbered, bulleted or "Tip 1"), cleaned. */
export function listItems(caption: string): string[] {
  return caption
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(\d{1,2}[.)]|[-*•✅✔️👉▪️]|tip\s*\d|step\s*\d)/iu.test(l))
    .map((l) => l.replace(/^(\d{1,2}[.)]|[-*•✅✔️👉▪️]+|(tip|step)\s*\d+[:.)-]?)\s*/iu, "").trim())
    .filter((l) => l.length >= 3);
}

const usable = (p: { mimeType?: string | null; path: string }) => {
  const type = p.mimeType ?? (/\.png$/i.test(p.path) ? "image/png" : /\.jpe?g$/i.test(p.path) ? "image/jpeg" : "");
  return type === "image/png" || type === "image/jpeg";
};

/** Album photos a template can draw (JPG or PNG), in album order. */
export function drawablePhotos(ctx: Pick<DirectionContext, "photos">): string[] {
  return ctx.photos.filter(usable).map((p) => p.path);
}

/**
 * Carousel or single image: a carousel when a network takes carousels and the content is a list of tips or steps
 * (three or more items), or the product has at least two photos that can be drawn.
 */
export function shouldCarousel(ctx: Pick<DirectionContext, "carouselAllowed" | "caption" | "photos">): boolean {
  if (!ctx.carouselAllowed) return false;
  return listItems(ctx.caption).length >= VISUAL_LIMITS.minCarouselSlides || drawablePhotos(ctx).length >= 2;
}

/** The first template that suits the subject and can be drawn with (or without) a photo. */
function defaultTemplate(subjectType: string, hasPhoto: boolean): TemplateId {
  const first = templatesForProjectType(subjectType).find((t) => t !== "quote") ?? "announcement";
  return !hasPhoto && PHOTO_TEMPLATES.includes(first) ? "announcement" : first;
}

/**
 * Picks each slide's picture: the album photo it asked for, else the next unused album photo; an AI photo only when
 * allowed and within the cap; a text design otherwise. Photo templates without a photo become announcements, and
 * a quote never gets an AI photo. Pure: the same input always gives the same answer.
 */
export function chooseSources(
  wanted: { source: "album" | "ai" | "none"; photo?: number; template: TemplateId }[],
  ctx: Pick<DirectionContext, "photos" | "aiAllowed" | "maxAi">,
): { source: SlideSource; photoPath: string | null; template: TemplateId }[] {
  const photos = drawablePhotos(ctx);
  const used = new Set<string>();
  const maxAi = ctx.aiAllowed ? (ctx.maxAi ?? VISUAL_LIMITS.maxAiPhotosPerVisual) : 0;
  let ai = 0;
  const nextPhoto = (preferred?: number) => {
    const asked = preferred !== undefined && preferred >= 0 ? photos[preferred] : undefined;
    const pick = asked && !used.has(asked) ? asked : photos.find((p) => !used.has(p));
    if (pick) used.add(pick);
    return pick ?? null;
  };
  return wanted.map((w) => {
    let source: SlideSource = "text";
    let photoPath: string | null = null;
    if (w.source === "ai" && ai < maxAi && w.template !== "quote") {
      source = "ai";
      ai += 1;
      // The real product stays recognisable: the photo the art director picked (else the cover) is the reference.
      photoPath = (w.photo !== undefined && w.photo >= 0 ? photos[w.photo] : undefined) ?? photos[0] ?? null;
    } else if (w.source !== "none" || PHOTO_TEMPLATES.includes(w.template)) {
      photoPath = nextPhoto(w.photo);
      if (photoPath) source = "album";
    }
    const template = source === "text" && PHOTO_TEMPLATES.includes(w.template) ? "announcement" : w.template;
    return { source, photoPath, template };
  });
}

function slide(base: Omit<VisualSlide, "designId" | "path">): VisualSlide {
  return { ...base, designId: null, path: null };
}

/**
 * Posts show people (owner decision): the cover becomes an AI scene with people whenever AI photos are allowed (the
 * album photo, if any, is the product reference). Quote cards stay designed. In a carousel with an AI cover, the
 * other slides are designed slides over the same photo, so a carousel uses one AI image.
 */
function withPeople(slides: VisualSlide[], ctx: DirectionContext, brief: PeopleBrief | null): VisualSlide[] {
  const coverAi = slides[0]?.source === "ai";
  return slides.map((s, i) => {
    if (s.source === "ai") return { ...s, scene: peopleScene(brief, ctx.audience, ctx.title, !!s.photoPath, s.scene) };
    if (i > 0 && coverAi && s.source === "text") return { ...s, useCoverPhoto: true, template: PHOTO_TEMPLATES.includes(s.template) ? "announcement" : s.template };
    return s;
  });
}

/** The cover asks for people: an album or plain cover turns into an AI scene when AI photos are allowed. */
function coverWithPeople(source: "album" | "ai" | "none", template: TemplateId, ctx: DirectionContext): "album" | "ai" | "none" {
  if (!ctx.aiAllowed || template === "quote") return source;
  return source === "album" ? "ai" : source;
}

/** The visual BuPulse makes on its own: used when the art director is not asked, fails or answers nonsense. */
export function fallbackPlan(ctx: DirectionContext, notes: string[] = []): ImagePlan {
  const pack = recommendPack(ctx.business);
  const photos = drawablePhotos(ctx);
  const max = Math.min(ctx.maxSlides ?? VISUAL_LIMITS.maxCarouselSlides, VISUAL_LIMITS.maxCarouselSlides);
  const headline = slideText(ctx.headlines[0] || ctx.title || ctx.business.name, VISUAL_LIMITS.headline);
  const firstSentence = slideText(ctx.caption.split(/(?<=[.!?])\s|\n/)[0] ?? "", VISUAL_LIMITS.subline);
  const chip = slideText(ctx.price ?? "", VISUAL_LIMITS.chip);
  const wantAi = ctx.aiAllowed;
  const coverTemplate = defaultTemplate(ctx.subjectType, photos.length > 0 || wantAi);

  const wanted: { source: "album" | "ai" | "none"; photo?: number; template: TemplateId }[] = [{ source: wantAi ? "ai" : "album", photo: 0, template: coverTemplate }];
  const texts: { headline: string; subline: string; chip: string }[] = [{ headline, subline: firstSentence === headline ? "" : firstSentence, chip }];

  if (shouldCarousel(ctx) && max >= VISUAL_LIMITS.minCarouselSlides) {
    const items = listItems(ctx.caption);
    if (items.length >= 2) {
      for (const item of items.slice(0, max - 1)) {
        // With an AI cover the tips are designed over the cover photo (withPeople); without, the next album photos.
        wanted.push({ source: !wantAi && photos.length > wanted.length ? "album" : "none", template: "announcement" });
        texts.push({ headline: slideText(item, VISUAL_LIMITS.headline), subline: "", chip: "" });
      }
    } else {
      // Several product photos: one slide each, with the selling lines as headlines.
      const lines = ctx.headlines.slice(1);
      for (let i = 1; i < Math.min(photos.length, max); i++) {
        wanted.push({ source: "album", photo: i, template: coverTemplate });
        texts.push({ headline: slideText(lines[i - 1] || ctx.title, VISUAL_LIMITS.headline), subline: "", chip: "" });
      }
    }
    const last = texts.length;
    if (last < VISUAL_LIMITS.minCarouselSlides) {
      wanted.splice(1);
      texts.splice(1);
    }
  }

  const chosen = chooseSources(wanted, ctx);
  const slides = chosen.map((c, i) =>
    slide({
      template: c.template,
      headline: texts[i].headline || headline,
      subline: texts[i].subline,
      chip: chipAllowed(texts[i].chip, [ctx.caption, ctx.price ?? "", ctx.title]) ? texts[i].chip : "",
      source: c.source,
      photoPath: c.photoPath,
      ...(c.source === "ai" ? { scene: ctx.title } : {}),
    }),
  );
  const people = slides.some((s) => s.source === "ai") ? defaultPeople(ctx.audience, ctx.title) : undefined;
  return { version: 1, pack, aspectRatio: "4:5", slides: withPeople(slides, ctx, people ?? null), directedBy: "rules", notes, ...(people ? { people } : {}) };
}

/**
 * Checks the art director's answer against the rules and repairs what it can: unknown pack or template, texts too
 * long or empty, invented numbers on chips, photos that do not exist, AI photos that are not allowed, a carousel
 * where none is allowed, too few or too many slides. An answer that cannot be parsed gives the fallback plan.
 */
export function validateDirection(raw: unknown, ctx: DirectionContext): ImagePlan {
  // An answer without the people brief is still usable: BuPulse writes the brief itself.
  const parsed = directionSchema.extend({ people: z.unknown().optional() }).safeParse(raw);
  if (!parsed.success) return fallbackPlan(ctx, ["BuPulse chose this design for you."]);
  const d = parsed.data;
  const pack: PackId = isPackId(d.pack) ? d.pack : recommendPack(ctx.business);
  const max = Math.min(ctx.maxSlides ?? VISUAL_LIMITS.maxCarouselSlides, VISUAL_LIMITS.maxCarouselSlides);
  const carousel = d.format === "carousel" && ctx.carouselAllowed && d.slides.length >= VISUAL_LIMITS.minCarouselSlides && max >= VISUAL_LIMITS.minCarouselSlides;
  const raws = carousel ? d.slides.slice(0, max) : d.slides.slice(0, 1);
  const sources = [ctx.caption, ctx.price ?? "", ctx.title, ...ctx.headlines];

  const texts = raws.map((s) => ({
    headline: slideText(s.headline, VISUAL_LIMITS.headline),
    subline: slideText(s.subline, VISUAL_LIMITS.subline),
    chip: slideText(s.chip, VISUAL_LIMITS.chip),
    kicker: slideText(s.kicker, VISUAL_LIMITS.kicker),
    scene: slideText(s.scene, 300),
  }));
  const wanted = raws.map((s, i) => {
    const asked: TemplateId = isTemplateId(s.template) ? s.template : defaultTemplate(ctx.subjectType, s.image !== "none");
    // A quote needs words to quote; a cover slide that is a quote with nothing quotable falls back.
    const template: TemplateId = asked === "quote" && i === 0 ? defaultTemplate(ctx.subjectType, s.image !== "none") : asked;
    return { source: i === 0 ? coverWithPeople(s.image, template, ctx) : s.image, photo: s.photo, template };
  });
  const chosen = chooseSources(wanted, ctx);
  const fallbackHeadline = slideText(ctx.headlines[0] || ctx.title || ctx.business.name, VISUAL_LIMITS.headline);
  const slides = chosen.map((c, i) =>
    slide({
      template: c.template,
      headline: texts[i].headline || (i === 0 ? fallbackHeadline : slideText(ctx.title, VISUAL_LIMITS.headline)),
      subline: texts[i].subline,
      chip: chipAllowed(texts[i].chip, sources) ? texts[i].chip : "",
      ...(texts[i].kicker ? { kicker: texts[i].kicker } : {}),
      source: c.source,
      photoPath: c.photoPath,
      ...(c.source === "ai" ? { scene: texts[i].scene || ctx.title } : {}),
    }),
  );
  const notes: string[] = [];
  if (raws.some((s) => s.image === "ai") && !slides.some((s) => s.source === "ai")) {
    notes.push(ctx.aiAllowed ? "One AI photo per post: the other slides use your photos or text." : "AI photos are not available right now, so your photos and free designs are used.");
  }
  const usesAi = slides.some((s) => s.source === "ai");
  const people = usesAi ? (readPeople(d.people) ?? defaultPeople(ctx.audience, ctx.title)) : undefined;
  return { version: 1, pack, aspectRatio: "4:5", slides: withPeople(slides, ctx, people ?? null), directedBy: "ai", notes, ...(people ? { people } : {}) };
}

/** A stored image plan read back defensively (JSON from the database). Null when it is not a usable plan. */
export function readImagePlan(value: unknown): ImagePlan | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<ImagePlan>;
  if (p.version !== 1 || !Array.isArray(p.slides) || p.slides.length === 0 || !isPackId(p.pack)) return null;
  if (!p.slides.every((s) => s && isTemplateId(s.template) && typeof s.headline === "string")) return null;
  return p as ImagePlan;
}
