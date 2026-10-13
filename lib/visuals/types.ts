// Content visuals (docs/CONTENT_VISUALS.md): the image, carousel or video that comes with every piece of content.
// Shapes and limits only. Client-safe (no server imports), so the content screens, the browser video renderer, the
// server and the tests share them.
import type { AspectRatio } from "@/lib/designs/layout";
import type { PackId } from "@/lib/designs/packs";
import type { TemplateId } from "@/lib/designs/templates/registry";

export type VisualKind = "image" | "carousel" | "video";
export type VisualStatus = "pending" | "ready" | "failed";
/** Where a slide's picture comes from: the product's or campaign's own album (free), an AI photo (1 image credit), or none (a text design). */
export type SlideSource = "album" | "ai" | "text";

export const VISUAL_LIMITS = {
  /** Slides in a carousel. */
  minCarouselSlides: 3,
  maxCarouselSlides: 5,
  /** Autopilot keeps its carousels shorter: a week has many posts and each slide is a render. */
  autopilotMaxSlides: 3,
  /** AI photos in one visual. */
  maxAiPhotosPerVisual: 1,
  /** AI photos in one Autopilot run (on top of the plan's image credits and the company's AI allowance). */
  maxAiPhotosPerRun: 5,
  /** Template renders in one Autopilot run. */
  maxRendersPerRun: 30,
  /** Server time one "render the next slides" call may use before it hands back (Netlify stops a function at 60 s). */
  renderStepMs: 30_000,
  headline: 60,
  subline: 110,
  chip: 24,
  kicker: 24,
} as const;

export const VIDEO_LIMITS = {
  width: 1080,
  height: 1920,
  fps: 30,
  minMs: 10_000,
  maxMs: 30_000,
  maxScenes: 7,
  minSceneMs: 2_000,
  maxSceneMs: 6_000,
  crossfadeMs: 500,
  sceneText: 90,
  /** Largest file the browser may upload (the media bucket allows 10 MB per file). */
  maxBytes: 8 * 1024 * 1024,
  /** Bitrate the encoder aims for: 30 s at 2 Mbit/s is about 7.5 MB. */
  bitrate: 2_000_000,
} as const;

/** Days a video file is kept after the last post that used it went out (lib/visuals/cleanup.ts). */
export const VIDEO_RETENTION_DAYS = 30;
/** What a visual says once the clean-up removed its file. */
export const VIDEO_REMOVED_NOTE = "Video removed after 30 days";
export const VIDEO_RETENTION_MESSAGE = "Published videos are removed from BuPulse 30 days after posting; they stay on your social accounts.";

/** One slide of an image or carousel visual: what the art director chose, and the design it became. */
export interface VisualSlide {
  template: TemplateId;
  headline: string;
  /** "" for none. */
  subline: string;
  /** Price, date or call to action; "" for none. */
  chip: string;
  /** The small label above the headline; undefined uses the template's own, "" hides it. */
  kicker?: string;
  source: SlideSource;
  /** The album photo drawn on the slide, or the reference photo for an AI photo. */
  photoPath: string | null;
  /** What an AI photo should show. */
  scene?: string;
  /** The AI photo once paid for (a Design in the designs bucket), so re-styling the slide never pays twice. */
  aiPhotoPath?: string | null;
  /** The rendered design. Null until the slide is drawn. */
  designId: string | null;
  path: string | null;
  /** Why the slide could not be drawn as planned (shown to the owner, never blocks the content). */
  note?: string;
}

export interface ImagePlan {
  version: 1;
  pack: PackId;
  aspectRatio: AspectRatio;
  slides: VisualSlide[];
  /** "ai" when the art director chose it; "rules" when its answer was unusable or AI was not allowed. */
  directedBy: "ai" | "rules";
  notes: string[];
}

export type Motion = "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

export interface VideoScene {
  /** The caption burned into this scene. */
  text: string;
  /** A media-bucket photo or a designs-bucket image; null draws the brand backdrop. */
  photoPath: string | null;
  durationMs: number;
  motion: Motion;
  /** "hook" is the opening line, "cta" the closing one; both are drawn larger. */
  role: "hook" | "body" | "cta";
}

export interface VideoPlan {
  version: 1;
  width: number;
  height: number;
  fps: number;
  pack: PackId;
  /** Background, text and accent colours (from the brand). */
  colors: { background: string; text: string; accent: string };
  businessName: string;
  scenes: VideoScene[];
  crossfadeMs: number;
  /** Length of the finished video, crossfades taken into account. */
  totalMs: number;
}

/** One stored output of a visual, in order: a design (image or slide) or a media file (the video). */
export interface VisualItem {
  designId?: string | null;
  path: string;
}

/** A visual as the content screens get it: plan, rendered items with signed URLs, and what the owner may do. */
export interface VisualView {
  id: string;
  kind: VisualKind;
  status: VisualStatus;
  error: string | null;
  items: { path: string; url: string; designId?: string | null }[];
  imagePlan: ImagePlan | null;
  videoPlan: VideoPlan | null;
  /** Signed URLs of the photos a video plan uses, by path, for the browser renderer. */
  photoUrls: Record<string, string>;
  renderedAt: string | null;
}
