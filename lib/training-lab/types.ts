import { z } from "zod";
import { buildVoiceExtras } from "./language";
import { buildScheduleNotes } from "./schedule";

// The Training Lab's examples (docs/TRAINING_LAB.md, model TrainingExample): what kinds there are, which engines read
// them, and the check on what the owner types in the Admin form. Shared by the server and the form, so no server-only.

export const KINDS = ["reel", "video", "image", "voice", "actor", "schedule"] as const;
export type TrainingKind = (typeof KINDS)[number];

export const ENGINES = ["video", "reel", "image", "post", "schedule", "language", "presenter"] as const;
export type TrainingEngine = (typeof ENGINES)[number];

export const KIND_LABELS: Record<TrainingKind, string> = {
  reel: "Reel",
  video: "Video",
  image: "Image or post",
  voice: "Kinyarwanda recording",
  actor: "Actor clip or portrait",
  schedule: "Posting habit",
};

export const ENGINE_LABELS: Record<TrainingEngine, string> = {
  video: "Video engine",
  reel: "Reel engine",
  image: "Image engine",
  post: "Post writer",
  schedule: "Posting and scheduling",
  language: "Kinyarwanda words and captions",
  presenter: "Presenters",
};

/** The engines a new example of this kind is switched on for until the owner changes it. */
export const DEFAULT_ENGINES: Record<TrainingKind, TrainingEngine[]> = {
  reel: ["reel", "video"],
  video: ["video"],
  image: ["image", "post"],
  voice: ["language"],
  actor: ["presenter"],
  schedule: ["schedule"],
};

export const LANGUAGES = ["Kinyarwanda", "English", "French", "Swahili"] as const;

export const TITLE_MAX = 120;
export const TEXT_MAX = 5_000;
export const TRANSCRIPT_MAX = 10_000;
export const TAG_MAX = 40;
export const TAGS_MAX = 30;

const text = (max: number, tooLong: string) => z.string().trim().max(max, tooLong);

const optionalText = (max: number, tooLong: string) =>
  text(max, tooLong)
    .nullish()
    .transform((v) => v || null);

/** Short labels, trimmed, lower case and without repeats ("Car Sellers" and "car sellers" are one tag). */
const labelList = (what: string) =>
  z
    .array(z.string().trim().max(TAG_MAX, `Keep each ${what} under ${TAG_MAX} letters.`))
    .max(TAGS_MAX, `Use up to ${TAGS_MAX} ${what}s.`)
    .default([])
    .transform((list) => [...new Set(list.map((t) => t.toLowerCase().replace(/\s+/g, " ")).filter(Boolean))]);

const sourceUrl = z
  .string()
  .trim()
  .max(2000, "That link is too long.")
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), "Use a full link starting with https://");

export const exampleInputSchema = z
  .object({
    kind: z.enum(KINDS, { error: "Choose what kind of example this is." }),
    title: text(TITLE_MAX, `Keep the title under ${TITLE_MAX} letters.`).min(1, "Give the example a title."),
    sourceUrl,
    /** True when a file is (or will be) uploaded with it; the file itself is checked by fileProblem. */
    hasFile: z.boolean().default(false),
    howMade: text(TEXT_MAX, "That is too long: keep how it was made to a few paragraphs.").min(1, "Say how it was made, in your own words."),
    whatIsGood: text(TEXT_MAX, "That is too long: keep what is good to a few paragraphs.").min(1, "Say what is good about it."),
    neverThis: optionalText(TEXT_MAX, "That is too long: keep what to never copy to a few paragraphs."),
    notes: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? null),
    tags: labelList("tag"),
    sector: optionalText(TAG_MAX, `Keep the sector under ${TAG_MAX} letters.`),
    language: optionalText(TAG_MAX, `Keep the language under ${TAG_MAX} letters.`),
    technique: labelList("technique"),
    rating: z
      .number({ error: "Rate it from 1 to 5 stars." })
      .int("Rate it from 1 to 5 stars.")
      .min(1, "Rate it from 1 to 5 stars.")
      .max(5, "Rate it from 1 to 5 stars.")
      .nullish()
      .transform((v) => v ?? null),
    consentGiven: z.boolean().default(false),
    consentName: optionalText(TITLE_MAX, `Keep the name under ${TITLE_MAX} letters.`),
    consentNote: optionalText(TEXT_MAX, "That consent note is too long."),
    engines: z
      .array(z.enum(ENGINES, { error: "That engine does not exist." }))
      .default([])
      .transform((list) => [...new Set(list)]),
    transcript: optionalText(TRANSCRIPT_MAX, "That is too long: keep what is said under 10,000 letters."),
    /** A posting habit as the owner types it (kind "schedule"); it becomes `notes` in the shape schedule.ts reads. */
    schedule: z
      .object({
        network: z.string().default(""),
        country: z.string().max(60).default(""),
        hours: z.string().max(200).default(""),
        weekdays: z.array(z.number()).max(7).default([]),
        postsPerWeek: z.union([z.string(), z.number(), z.null()]).default(""),
        formats: z.array(z.string()).max(20).default([]),
      })
      .nullish(),
    /** A recording's spellings to avoid ("wrong -> right" per line) and right words (commas), kept in `notes`. */
    voice: z.object({ wrong: z.string().max(10_000).default(""), words: z.string().max(10_000).default("") }).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "schedule" && !v.hasFile && !v.sourceUrl) ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Add a file or a link to the example." });
    if (v.kind === "voice" && !v.transcript) ctx.addIssue({ code: "custom", path: ["transcript"], message: "Write what is said in the recording." });
    if (v.kind === "actor" && !v.consentGiven) ctx.addIssue({ code: "custom", path: ["consentGiven"], message: "Only add an actor who agreed to be used: tick the consent box." });
    if (v.consentGiven && !v.consentName) ctx.addIssue({ code: "custom", path: ["consentName"], message: "Write the name of the person who agreed." });
    if (v.kind === "schedule") {
      const { problem } = buildScheduleNotes(v.schedule);
      if (problem) ctx.addIssue({ code: "custom", path: ["schedule"], message: problem });
    }
    if (v.kind === "voice") {
      const { problem } = buildVoiceExtras(v.voice);
      if (problem) ctx.addIssue({ code: "custom", path: ["voice"], message: problem });
    }
  })
  .transform((v) => (v.kind === "schedule" ? { ...v, notes: buildScheduleNotes(v.schedule).notes as Record<string, unknown> | null } : v))
  // For a recording, the extras are kept apart; examples.ts merges them into the notes (the AI-drafted fields stay).
  .transform((v) => ({ ...v, voiceExtras: v.kind === "voice" ? buildVoiceExtras(v.voice).extras : null }));

export type ExampleInput = z.output<typeof exampleInputSchema>;

// The files an example may have, by kind. They match the "training-lab" bucket's allowed types (the migration).
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const IMAGE = /^image\/(jpeg|png|webp|heic|heif)$/;
const VIDEO = /^video\/(mp4|quicktime|webm|x-m4v)$/;
const AUDIO = /^audio\/(mpeg|mp4|x-m4a|aac|ogg|webm|wav|x-wav)$/;

const FILE_KINDS: Record<TrainingKind, { types: RegExp[]; what: string }> = {
  reel: { types: [VIDEO], what: "a video" },
  video: { types: [VIDEO], what: "a video" },
  image: { types: [IMAGE], what: "a photo or image" },
  voice: { types: [AUDIO, VIDEO], what: "a recording" },
  actor: { types: [IMAGE, VIDEO], what: "a photo or a video" },
  schedule: { types: [IMAGE], what: "a screenshot" },
};

/** Why this file cannot be an example of this kind, or null. */
export function fileProblem(file: { name: string; type: string; size: number }, kind: TrainingKind): string | null {
  const type = file.type.toLowerCase();
  const rule = FILE_KINDS[kind];
  if (!rule.types.some((t) => t.test(type))) return `${file.name} is not ${rule.what}. A ${KIND_LABELS[kind].toLowerCase()} needs ${rule.what}.`;
  if (!Number.isFinite(file.size) || file.size <= 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  return null;
}

/** The first problem in plain words, or null when the input is fine. */
export function exampleInputProblem(input: unknown): string | null {
  const parsed = exampleInputSchema.safeParse(input);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check the example and try again.");
}
