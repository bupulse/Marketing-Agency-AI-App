import type { MarketingContent } from "@/lib/ai/marketing";
import type { EvalCase } from "./businesses";

const LANGUAGE_WORDS: Record<string, { words: string[]; min: number }> = {
  English: { words: ["the", "and", "for", "with", "your", "you", "our", "to", "a", "of"], min: 3 },
  French: { words: ["le", "la", "les", "de", "des", "et", "pour", "un", "une", "vous", "nous", "avec", "votre"], min: 3 },
  Spanish: { words: ["el", "la", "los", "las", "de", "para", "con", "y", "que", "un", "una", "tu", "su"], min: 3 },
  Swahili: { words: ["na", "kwa", "ya", "wa", "ni", "katika", "yetu", "karibu", "sana", "za", "la"], min: 2 },
  Kinyarwanda: { words: ["ni", "mu", "na", "ku", "kandi", "cyane", "muri", "ubu", "bwa", "rwa", "yacu", "dufite", "twe", "murakaza", "mwiza", "nziza"], min: 2 },
};

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}']+/gu) ?? [];

/** Digit groups with separators removed: "485,000" and "485.000" both become "485000". */
function numbers(text: string): string[] {
  return (text.match(/\d+(?:[.,\s]\d{3})*(?:[.,]\d+)?|\d+/g) ?? []).map((n) => n.replace(/[.,\s]/g, ""));
}

// Timestamps and the 30-second length are part of the script format, not facts.
function withoutScriptNumbers(script: string) {
  return script
    .replace(/\d{1,2}:\d{2}/g, " ")
    .replace(/\d+\s*[-–—]\s*\d+\s*(?:s\b|sec\w*|seconds?|secondes|segundos|sekunde\w*|sekunde|saa)?/gi, " ")
    .replace(/\b\d+\s*(?:s|sec\w*|seconds?|secondes|segundos|sekunde|-second)\b/gi, " ")
    .replace(/\b(?:scene|scène|escena|shot|plan|take|tukio|igice)\s*\d+/gi, " ");
}

export function inputText(c: EvalCase) {
  const { brand, project } = c;
  return [
    brand.businessName, brand.industry, brand.description, brand.audience, brand.website,
    brand.knowledge?.hours, brand.knowledge?.area, brand.knowledge?.contact,
    project.title, project.price, ...project.features, project.extraDetails,
  ].filter(Boolean).join(" ");
}

/** Returns a list of problems; an empty list means the content passes. */
export function checkContent(c: EvalCase, content: MarketingContent): string[] {
  const problems: string[] = [];
  const language = c.brand.contentLanguage ?? "English";

  if (!content.caption.trim()) problems.push("empty caption");
  if (!content.videoScript.trim()) problems.push("empty video script");
  if (content.adHeadlines.length < 2 || content.adHeadlines.length > 3) problems.push(`${content.adHeadlines.length} headlines (want 2-3)`);
  for (const h of content.adHeadlines) if (h.length > 40) problems.push(`headline over 40 chars: "${h}"`);
  if (content.hashtags.length < 8 || content.hashtags.length > 15) problems.push(`${content.hashtags.length} hashtags (want 8-15)`);
  if (content.hashtags.some((t) => !/^#\S+$/.test(t))) problems.push("malformed hashtag");
  if (/#\S/.test(content.caption)) problems.push("caption contains hashtags");

  // Numbers must come from the input.
  const allowed = [...numbers(inputText(c)), ...(c.impliedNumbers ?? [])];
  const written = numbers([content.caption, withoutScriptNumbers(content.videoScript), ...content.adHeadlines, ...content.hashtags].join("\n"));
  for (const n of written) {
    if (!allowed.some((a) => a === n || a.includes(n))) problems.push(`number "${n}" is not in the input`);
  }

  // Mentions the title, the business, or a distinctive word of the title.
  const caption = content.caption.toLowerCase();
  const titleWords = wordsOf(c.project.title).filter((w) => w.length >= 5);
  const mentions =
    caption.includes(c.project.title.toLowerCase()) ||
    caption.includes(c.brand.businessName.toLowerCase()) ||
    titleWords.some((w) => caption.includes(w));
  if (!mentions) problems.push("caption does not mention the title or the business");

  const rule = LANGUAGE_WORDS[language];
  if (rule) {
    const set = new Set(wordsOf(`${content.caption} ${content.videoScript}`));
    const hits = rule.words.filter((w) => set.has(w)).length;
    if (hits < rule.min) problems.push(`does not look like ${language} (${hits} common words)`);
  }
  return problems;
}
