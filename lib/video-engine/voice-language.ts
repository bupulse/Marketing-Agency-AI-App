// Which language a video's voice-over speaks (docs/VIDEO_ENGINE.md, "Voice-over"). The voice model
// (eleven_multilingual_v2) cannot speak Kinyarwanda or Swahili: for those businesses the on-screen text and the caption
// stay in the content language and the say lines are written and spoken in English. Pure and dependency-free, shared by
// the designer (what Claude is asked to write) and voice.ts (what is spoken).

/**
 * The business content languages (lib/brand/languages.ts) that eleven_multilingual_v2 speaks well. Kinyarwanda and
 * Swahili are not among them (owner decision, 17 October 2026): those videos keep their on-screen text and caption in
 * the content language and the voice speaks English.
 */
export const SPOKEN_LANGUAGES = ["English", "French", "Spanish", "Portuguese", "Arabic", "German", "Italian", "Dutch", "Hindi", "Chinese (Simplified)", "Japanese", "Turkish", "Indonesian"] as const;

export type VoiceLanguage = {
  /** The language the say lines are written and spoken in. */
  spokenLanguage: string;
  /** The language of the on-screen text and the caption (the business's content language). */
  captionLanguage: string;
  /** Shown to the owner when the two differ; null when they are the same. */
  note: string | null;
};

const ALIASES: Record<string, string> = { rw: "Kinyarwanda", kin: "Kinyarwanda", ikinyarwanda: "Kinyarwanda", kinyarwanda: "Kinyarwanda", fr: "French", francais: "French", français: "French", en: "English", sw: "Swahili", kiswahili: "Swahili" };

/** Which language the voice-over speaks for a business content language. Pure. */
export function voiceLanguage(contentLanguage: string | null | undefined): VoiceLanguage {
  const raw = (contentLanguage ?? "").trim();
  const key = raw.toLowerCase();
  const caption = ALIASES[key] ?? SPOKEN_LANGUAGES.find((l) => l.toLowerCase() === key) ?? (raw || "English");
  const spoken = (SPOKEN_LANGUAGES as readonly string[]).includes(caption) ? caption : "English";
  return {
    spokenLanguage: spoken,
    captionLanguage: caption,
    note: spoken === caption ? null : `The voice cannot speak ${caption} yet, so the voice-over is in ${spoken} and the text on screen stays in ${caption}.`,
  };
}

// Very common Kinyarwanda words: enough of them in a line means it is Kinyarwanda, which the voice would mispronounce.
const KINYARWANDA_WORDS = new Set("ni na mu ku kandi cyane muri ubu uyu iyi aha hano mwe twe ngo nka buri gusa ariko kuri nta ndetse murakaza neza muraho mwiriwe mwaramutse amafaranga igiciro inzu telefoni gura mugure muze twandikire ubu nonaha byiza bishya rwanda kigali".split(" "));
const KINYARWANDA_PATTERN = /(?:mu|ku|i|u|a|ba|bi|ki|n|y|tw|mw)[a-z]*(?:aga|ira|ana|ize|wa|ye|mo|ho|ko)/;

/** True when the say lines look like Kinyarwanda (several of its most common words, or its word shapes). Pure. */
export function looksKinyarwanda(text: string): boolean {
  const words = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z']+/g) ?? [];
  if (words.length === 0) return false;
  const common = words.filter((w) => KINYARWANDA_WORDS.has(w) && w !== "kigali" && w !== "rwanda").length;
  const shaped = words.filter((w) => w.length > 4 && KINYARWANDA_PATTERN.test(w)).length;
  return common / words.length >= 0.2 || (common >= 1 && (common + shaped) / words.length >= 0.35);
}
