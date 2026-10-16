import { z } from "zod";
import { isValidTimeZone } from "./time";

export const MAX_ACCOUNTS_PER_POST = 12;
export const MAX_MEDIA_PER_POST = 10;
export const TEXT_MAX = 10_000;

export const hashtagList = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .transform((tags) => [...new Set(tags.map((t) => `#${t.replace(/^#+/, "").replace(/\s+/g, "")}`).filter((t) => t.length > 1))]);

const when = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("queue") }),
  z.object({ mode: z.literal("schedule"), local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time.") }),
  z.object({ mode: z.literal("draft") }),
  z.object({ mode: z.literal("now") }),
]);

export const optionalLink = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), "Use a full link starting with https://");

const overrides = z
  .record(z.string(), z.object({ text: z.string().max(TEXT_MAX).optional(), hashtags: hashtagList.optional() }))
  .default({});

const mediaPaths = z.array(z.string().min(1).max(300)).max(MAX_MEDIA_PER_POST, `Use up to ${MAX_MEDIA_PER_POST} photos.`).default([]);

export const composeSchema = z.object({
  connectionIds: z.array(z.string().min(1).max(60)).min(1, "Choose at least one account.").max(MAX_ACCOUNTS_PER_POST),
  text: z.string().max(TEXT_MAX, "That is too long."),
  hashtags: hashtagList.default([]),
  overrides,
  mediaPaths,
  link: optionalLink,
  /** The product or campaign the post is about (an old project id works: it is the same id). */
  subjectId: z.string().max(60).nullish(),
  contentId: z.string().max(60).nullish(),
  when,
});

export const editSchema = z.object({
  text: z.string().max(TEXT_MAX, "That is too long."),
  hashtags: hashtagList.default([]),
  mediaPaths,
  link: optionalLink,
  when: z.union([when, z.object({ mode: z.literal("keep") })]),
});

export const timezoneSchema = z.string().trim().max(80).refine(isValidTimeZone, "That is not a time zone we know.");

export type ComposeParsed = z.infer<typeof composeSchema>;
export type EditParsed = z.infer<typeof editSchema>;

/** Gallery photos and designs live under the owner's id; nothing outside it may be attached. */
export function isOwnMediaPath(userId: string, path: string) {
  return path.startsWith(`${userId}/`) && !path.includes("..") && !path.includes("//") && path.length <= 300;
}

/**
 * The storage bucket a path belongs to: designs are stored as <userId>/designs/..., Gallery videos and their posters as
 * <userId>/clips/... (the private "gallery-videos" bucket, docs/MEDIA.md), everything else is in "media".
 */
export function bucketForPath(path: string): "media" | "designs" | "gallery-videos" {
  const folder = path.split("/")[1];
  return folder === "designs" ? "designs" : folder === "clips" ? "gallery-videos" : "media";
}
