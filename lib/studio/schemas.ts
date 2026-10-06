import { z } from "zod";

export const MAX_PROJECT_PHOTOS = 10;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const MAX_HEADLINE_LENGTH = 40;

/** Photos live in the "media" bucket under `<userId>/projects/`. */
export function photoPrefix(userId: string) {
  return `${userId}/projects/`;
}

export function isOwnPhotoPath(userId: string, path: string) {
  return path.startsWith(photoPrefix(userId)) && !path.includes("..") && path.length <= 300;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((v) => v || undefined);

/** Fields of a project as the studio form sends them. Photo ownership is checked with the user id. */
export function projectInputSchema(userId: string) {
  return z.object({
    type: z.string().trim().toLowerCase().min(1, "Choose what you are promoting.").max(40),
    title: z.string().trim().min(1, "Give it a name.").max(200, "Use 200 characters or fewer."),
    price: optionalText(100),
    features: z
      .array(z.string().trim().min(1).max(200, "Use 200 characters or fewer."))
      .max(20, "Add up to 20 features.")
      .default([]),
    details: optionalText(2000),
    photoPaths: z
      .array(z.string().refine((p) => isOwnPhotoPath(userId, p), "That photo could not be used."))
      .max(MAX_PROJECT_PHOTOS, `Add up to ${MAX_PROJECT_PHOTOS} photos.`)
      .default([]),
  });
}

export type ProjectInput = z.input<ReturnType<typeof projectInputSchema>> & { generate?: boolean };

export const instructionSchema = z
  .string()
  .trim()
  .max(500, "Use 500 characters or fewer.")
  .optional()
  .transform((v) => v || undefined);

export const editedContentSchema = z.object({
  caption: z.string().trim().min(1, "The caption cannot be empty.").max(5000),
  hashtags: z.array(z.string().trim().max(100)).max(30).default([]),
  videoScript: z.string().trim().max(8000).default(""),
  adHeadlines: z.array(z.string().trim().min(1).max(100)).max(5).default([]),
});
