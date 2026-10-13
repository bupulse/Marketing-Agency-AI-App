// Pure helpers for the content studio screens (no React, no server code), so they are easy to test.
import type { VisualView } from "@/lib/visuals/types";

export const MAX_FEATURES = 10;
export const MAX_PHOTOS = 10;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ProjectTypeOption = {
  value: string;
  label: string;
  hint: string;
  titlePlaceholder: string;
  pricePlaceholder: string;
  featurePlaceholder: string;
  detailsPlaceholder: string;
};

/** Types that suit any business. The placeholders only guide what to write. */
export const PROJECT_TYPES: ProjectTypeOption[] = [
  {
    value: "product",
    label: "Product",
    hint: "Something you sell",
    titlePlaceholder: "Handmade leather tote bag",
    pricePlaceholder: "$49 or From $49",
    featurePlaceholder: "Fits a 14 inch laptop",
    detailsPlaceholder: "Colours, sizes, materials, what makes it different, how to order.",
  },
  {
    value: "service",
    label: "Service",
    hint: "Work you do for people",
    titlePlaceholder: "Deep home cleaning",
    pricePlaceholder: "From $80 per visit",
    featurePlaceholder: "Same-week booking",
    detailsPlaceholder: "Who it is for, what is included, areas you cover, how to book.",
  },
  {
    value: "event",
    label: "Event",
    hint: "Something with a date",
    titlePlaceholder: "Summer open day",
    pricePlaceholder: "Free entry or $15 per ticket",
    featurePlaceholder: "Live music from 6 pm",
    detailsPlaceholder: "Date, time and place, who should come, how to register.",
  },
  {
    value: "offer",
    label: "Offer",
    hint: "A deal or discount",
    titlePlaceholder: "Weekend 20% off sale",
    pricePlaceholder: "20% off or Buy one get one free",
    featurePlaceholder: "Valid on all items",
    detailsPlaceholder: "Start and end dates, what it applies to, any code or conditions.",
  },
  {
    value: "listing",
    label: "Listing",
    hint: "A property, vehicle or item for sale or rent",
    titlePlaceholder: "3-bedroom family home, Riverside",
    pricePlaceholder: "$485,000 or $900 per month",
    featurePlaceholder: "Large garden",
    detailsPlaceholder: "Address or area, size, condition, viewing times, contact.",
  },
  {
    value: "project",
    label: "Project",
    hint: "Finished work you want to show",
    titlePlaceholder: "Kitchen renovation in Westfield",
    pricePlaceholder: "Optional",
    featurePlaceholder: "Finished in 3 weeks",
    detailsPlaceholder: "What you did, the result, what the client said.",
  },
  {
    value: "other",
    label: "Other",
    hint: "Anything else",
    titlePlaceholder: "What you want to promote",
    pricePlaceholder: "Optional",
    featurePlaceholder: "A key point",
    detailsPlaceholder: "Anything the writer should know.",
  },
];

export function getProjectType(value: string): ProjectTypeOption {
  return PROJECT_TYPES.find((t) => t.value === value) ?? PROJECT_TYPES[PROJECT_TYPES.length - 1];
}

export function typeLabel(value: string): string {
  const known = PROJECT_TYPES.find((t) => t.value === value);
  if (known) return known.label;
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Other";
}

/** Adds a key feature: trimmed, no duplicates (ignoring case), up to MAX_FEATURES. */
export function addFeature(features: string[], raw: string): string[] {
  const value = raw.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!value || features.length >= MAX_FEATURES) return features;
  if (features.some((f) => f.toLowerCase() === value.toLowerCase())) return features;
  return [...features, value];
}

/** "summer sale" or "#Summer Sale!" becomes "#SummerSale". Returns "" when nothing usable is left. */
export function normalizeHashtag(raw: string): string {
  const body = raw.replace(/[^\p{L}\p{N}_]/gu, "");
  return body ? `#${body}` : "";
}

export function addHashtag(tags: string[], raw: string, max = 30): string[] {
  const tag = normalizeHashtag(raw);
  if (!tag || tags.length >= max) return tags;
  if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}

/** Caption and hashtags together, the way they are pasted into a post. */
export function formatCopyText(caption: string, hashtags: string[]): string {
  const tags = hashtags.map(normalizeHashtag).filter(Boolean).join(" ");
  return tags ? `${caption.trim()}\n\n${tags}` : caption.trim();
}

/** Characters a network counts for a post: caption plus the hashtag line. */
export function postLength(caption: string, hashtags: string[]): number {
  return formatCopyText(caption, hashtags).length;
}

export type Network = "instagram" | "facebook" | "tiktok" | "linkedin" | "x";

export const NETWORKS: { value: Network; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
];

export type StudioVariant = {
  network: Network;
  caption: string;
  hashtags: string[];
  aspectRatio: string;
  characterCount: number;
  limit: number;
};

/** Reads the variants JSON stored with a generated text. Anything malformed is skipped. */
export function parseVariants(value: unknown): StudioVariant[] {
  if (!Array.isArray(value)) return [];
  const out: StudioVariant[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const network = NETWORKS.find((n) => n.value === v.network)?.value;
    if (!network || typeof v.caption !== "string") continue;
    const hashtags = Array.isArray(v.hashtags) ? v.hashtags.filter((h): h is string => typeof h === "string") : [];
    out.push({
      network,
      caption: v.caption,
      hashtags,
      aspectRatio: typeof v.aspectRatio === "string" ? v.aspectRatio : "1:1",
      characterCount: typeof v.characterCount === "number" ? v.characterCount : postLength(v.caption, hashtags),
      limit: typeof v.limit === "number" && v.limit > 0 ? v.limit : 0,
    });
  }
  return out;
}

export const ASPECT_NOTES: Record<string, string> = {
  "1:1": "Square image",
  "4:5": "Portrait image",
  "9:16": "Tall vertical image or video",
  "16:9": "Wide image or video",
};

export function aspectNote(ratio: string): string {
  const note = ASPECT_NOTES[ratio];
  return note ? `${ratio} · ${note}` : ratio;
}

/** What content is written for: a product or a campaign (Knowledge base). */
export type StudioSubject = { kind: "product" | "campaign"; id: string };

/** A product's or campaign's content, as the screens use it (dates as ISO strings so it can cross to the browser). */
export type StudioContent = {
  id: string;
  caption: string;
  hashtags: string[];
  videoScript: string;
  adHeadlines: string[];
  language: string;
  variants: StudioVariant[];
  edited: boolean;
  createdAt: string;
  /** The picture (image or carousel) and the video that come with this version (docs/CONTENT_VISUALS.md). */
  image?: VisualView | null;
  video?: VisualView | null;
};

export const REGENERATE_IDEAS = ["Make it shorter", "More playful", "More professional", "Mention free delivery", "Add a call to action"];

/** The note shown when text is generated, e.g. "Uses 1 text generation (12 of 50 used)". */
export function usageNote(used?: number, limit?: number): string {
  if (typeof used === "number" && typeof limit === "number" && limit > 0) {
    return `Uses 1 text generation. You have used ${Math.min(used, limit)} of ${limit} this month.`;
  }
  return "Uses 1 text generation.";
}

/** Short date for lists, in the viewer's locale. */
export function formatWhen(iso: string | Date | null | undefined): string {
  if (!iso) return "Not yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not yet";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatWhenWithTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Reads the details saved with a project as plain text (older or other shapes become empty text). */
export function detailsText(details: unknown): string {
  return typeof details === "string" ? details : "";
}

/** Why a picked file cannot be used as a project photo, or null when it is fine. */
export function photoProblem(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return "Use a JPG, PNG or WebP image.";
  if (file.size > PHOTO_MAX_BYTES) return "Each photo must be 10 MB or smaller.";
  return null;
}
