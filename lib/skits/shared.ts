// Talking skits (docs: the Skit model in prisma/schema.prisma): what the Posts page, the recorder, the server and the
// tests share. Pure and client-safe.

/** An extra skit beyond the plan's, in RWF before VAT (owner decision, 31 October 2026; clients see it with VAT, lib/billing/vat.ts). Shown as a request: no payment yet. */
export const EXTRA_SKIT_PRICE_RWF = 5_000;
/** How long a skit is: about 10 seconds of talking (Seedance takes 4 to 15). */
export const SKIT_SECONDS = 10;
export const SKIT_MIN_SECONDS = 4;
export const SKIT_MAX_SECONDS = 15;
/** Speakers in one skit: Seedance takes up to 3 reference voices, one per person. */
export const MAX_SPEAKERS = 3;
/** Lines in one skit. */
export const MAX_LINES = 6;
/** One line's words, read aloud in about 2 to 4 seconds. */
export const MAX_LINE_CHARS = 140;

/** Extras a company may have waiting at once (a request each, until BuPulse confirms it). */
export const MAX_OPEN_EXTRAS = 3;

export const SKIT_STATUSES = ["ORDERED", "WRITING", "WRITE_FAILED", "WAITING_VOICE", "VOICE_RECEIVED", "MAKING", "READY", "FAILED", "EXPIRED"] as const;
export type SkitStatus = (typeof SKIT_STATUSES)[number];

export type SkitLine = { speaker: number; text: string };
export type SkitSpeaker = { name: string; look: string };

/** The stored lines as a clean list (speaker numbers start at 1, within the speakers). */
export function readLines(value: unknown, speakers = MAX_SPEAKERS): SkitLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
    .map((l) => ({ speaker: Number(l.speaker), text: typeof l.text === "string" ? l.text.trim() : "" }))
    .filter((l) => Number.isInteger(l.speaker) && l.speaker >= 1 && l.speaker <= speakers && l.text)
    .slice(0, MAX_LINES);
}

export function readSpeakers(value: unknown): SkitSpeaker[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .map((s, i) => ({ name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 40) : `Person ${i + 1}`, look: typeof s.look === "string" ? s.look.trim().slice(0, 200) : "" }))
    .slice(0, MAX_SPEAKERS);
}

/** Speakers that still have no voice note ("" or missing in voicePaths), by number (1-based). */
export function missingVoices(speakerCount: number, voicePaths: readonly string[]): number[] {
  return Array.from({ length: speakerCount }, (_, i) => i + 1).filter((n) => !voicePaths[n - 1]);
}

/** What the client reads on the card for each status. */
export const STATUS_TEXT: Record<SkitStatus, string> = {
  ORDERED: "Extra skit requested. BuPulse will call you to confirm it.",
  WRITING: "BuPulse is writing your skit…",
  WRITE_FAILED: "BuPulse is writing your skit…",
  WAITING_VOICE: "Record your skit",
  VOICE_RECEIVED: "Voice received — video coming soon",
  MAKING: "Making your video… it shows here when it is ready.",
  READY: "Your skit video is ready: approve it in Posts.",
  FAILED: "We could not make this video. BuPulse will look at it.",
  EXPIRED: "This skit was not recorded in time.",
};

/** Statuses a card shows on the Posts page (the open ones). */
export const OPEN_STATUSES: readonly SkitStatus[] = ["ORDERED", "WAITING_VOICE", "VOICE_RECEIVED", "MAKING", "FAILED"];

// ---- Voice notes ------------------------------------------------------------------------------------------------------

/** The longest voice note taken, in bytes: a 15 s WAV is about 0.5 MB; a phone's own file is smaller. */
export const VOICE_MAX_BYTES = 8 * 1024 * 1024;
/** The longest recording the recorder makes, in seconds (one speaker's lines). */
export const VOICE_MAX_SECONDS = SKIT_MAX_SECONDS;

/** The audio types taken, with the file ending each is saved under. WhatsApp voice notes are Ogg Opus. */
export const VOICE_TYPES: Readonly<Record<string, string>> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
};

const BY_EXTENSION: Readonly<Record<string, string>> = { wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus", webm: "audio/webm", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg" };

/** The accept attribute of the file picker. */
export const VOICE_ACCEPT = [...new Set([...Object.keys(VOICE_TYPES), ...Object.keys(BY_EXTENSION).map((e) => `.${e}`)])].join(",");

/**
 * The audio type of an upload: its own type when it is one we take (codecs dropped), else from its file ending (phones
 * often send a WhatsApp note as application/octet-stream). Null when it is not a voice note we take.
 */
export function voiceType(file: { type: string; name?: string }): string | null {
  const mime = file.type.split(";")[0].trim().toLowerCase();
  if (VOICE_TYPES[mime]) return mime;
  const ext = (file.name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? (BY_EXTENSION[ext] ?? null) : null;
}

export type VoiceCheck = { ok: true; mime: string; ext: string } | { ok: false; error: string };

export function checkVoice(file: { type: string; size: number; name?: string }): VoiceCheck {
  const mime = voiceType(file);
  if (!mime) return { ok: false, error: "Send a voice note or audio file (.ogg, .opus, .m4a, .mp3 or .wav)." };
  if (file.size <= 0) return { ok: false, error: "That recording is empty. Record it again." };
  if (file.size > VOICE_MAX_BYTES) return { ok: false, error: "That recording is too long. Keep each voice note under 15 seconds." };
  return { ok: true, mime, ext: VOICE_TYPES[mime] };
}
