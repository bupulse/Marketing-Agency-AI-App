// Seeding the music library from a folder of original tracks (docs/VOICE_AND_MUSIC.md). The logic lives here so it is
// committed and tested; the runner is scripts/local/seed-music.mjs (scripts/local is git-ignored, like the files).
// Files are named NN-mood-name.mp3 ("02-amapiano-groove.mp3"): the title and mood tags come from the name.

export const MOODS = ["upbeat", "calm", "corporate", "inspiring", "afro", "acoustic", "warm", "energetic"];
/** Words in file names that mean one of the library's moods. */
const SYNONYMS = {
  afrobeats: "afro", afrobeat: "afro", amapiano: "afro", afro: "afro", highlife: "afro",
  chill: "calm", lofi: "calm", ambient: "calm", soft: "calm", calm: "calm", gentle: "calm",
  corporate: "corporate", business: "corporate", tech: "corporate",
  inspiring: "inspiring", cinematic: "inspiring", uplifting: "inspiring", motivational: "inspiring",
  acoustic: "acoustic", guitar: "acoustic", folk: "acoustic",
  warm: "warm", cozy: "warm", romantic: "warm",
  energetic: "energetic", hype: "energetic", dance: "energetic", edm: "energetic", sport: "energetic",
  upbeat: "upbeat", happy: "upbeat", pop: "upbeat", fun: "upbeat", bright: "upbeat", groove: "upbeat",
  elegant: "calm", luxury: "calm", piano: "calm", jazz: "warm", modern: "corporate", celebration: "energetic", festive: "energetic", morning: "upbeat",
  // Emotional and quiet subjects (review, 13 October 2026): never "upbeat" by default.
  reflective: "inspiring", story: "warm", emotional: "inspiring", education: "calm", focus: "calm", study: "calm", spa: "calm",
  beauty: "calm", estate: "calm", family: "warm", kids: "warm", food: "warm", kitchen: "warm", drums: "afro", african: "afro",
  pride: "inspiring", sale: "energetic", promo: "energetic", fashion: "energetic", runway: "energetic",
};

/**
 * The moods of the 20 original tracks, chosen by ear rather than from the file name (owner's library, October 2026).
 * The library has 8 moods: "emotional" is inspiring + warm, "focus" and "elegant" are calm.
 */
export const SEED_MOODS = {
  "upbeat-afrobeats": ["afro", "upbeat"],
  "amapiano-groove": ["afro", "upbeat"],
  "afro-pop-celebration": ["afro", "upbeat", "energetic"],
  "calm-acoustic": ["calm", "acoustic"],
  "corporate-inspiring": ["corporate", "inspiring"],
  "tech-modern": ["corporate"],
  "fresh-morning": ["upbeat", "warm"],
  "elegant-luxury": ["calm", "warm"],
  "energetic-sport": ["energetic"],
  "chill-lofi": ["calm"],
  "food-kitchen": ["warm", "upbeat"],
  "real-estate-calm": ["calm"],
  "kids-friendly-family": ["upbeat", "warm"],
  "fashion-runway": ["energetic", "upbeat"],
  "beauty-spa": ["calm"],
  "event-hype": ["energetic"],
  "education-focus": ["calm", "inspiring"],
  "african-drums-pride": ["afro", "energetic", "inspiring"],
  "sale-promo": ["energetic", "upbeat"],
  "reflective-story": ["inspiring", "warm", "calm"],
};

export const LICENCE = "Original — generated with ElevenLabs Music for BuPulse (commercial use, paid plan)";
export const SOURCE = "ElevenLabs Music";

/** "02-amapiano-groove.mp3" -> { title: "Amapiano Groove", moods: ["afro", "upbeat"] }. Null for other files. */
export function trackFromFilename(name) {
  const m = /^(\d{1,3})[-_ ]+([a-z0-9][a-z0-9 _-]*)\.mp3$/i.exec(name);
  if (!m) return null;
  const words = m[2].toLowerCase().split(/[-_ ]+/).filter(Boolean);
  const known = SEED_MOODS[words.join("-")];
  const moods = known ?? [...new Set(words.map((w) => SYNONYMS[w]).filter(Boolean))].slice(0, 4);
  const title = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").slice(0, 120);
  return { title, moods: moods.length ? moods : ["upbeat"] };
}

/** An MP3 by its first bytes (ID3 tag or an MPEG frame). */
export function isMp3(bytes) {
  return (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

/** The storage path of a seeded track: stable, so running the seed twice adds nothing twice. */
export function seedPath(fileName) {
  return `seed-${fileName.toLowerCase().replace(/[^a-z0-9.-]+/g, "-")}`;
}

/**
 * The one-off correction for tracks seeded with the first, weaker moods: the SQL that sets each seeded track's moods
 * from SEED_MOODS (only rows the seed made; an admin's own tracks are not touched). Also shipped as the migration
 * 20261017120000_music_seed_moods.
 */
export function moodUpdateSql() {
  return Object.entries(SEED_MOODS)
    .map(([slug, moods]) => `UPDATE "MusicTrack" SET "moods" = ARRAY[${moods.map((m) => `'${m}'`).join(", ")}]::TEXT[], "updatedAt" = now() WHERE "createdBy" = 'seed-music' AND "path" LIKE 'seed-__-${slug}.mp3';`)
    .join("\n");
}
