// Brand style packs: metadata and the automatic choice. Client-safe (no rendering code), so the
// studio can list the packs and mark the one that matches the business.
export type PackId = "elegant" | "bold" | "warm" | "clean" | "playful";

export type PackInfo = {
  id: PackId;
  name: string;
  description: string;
};

export const PACKS: PackInfo[] = [
  { id: "clean", name: "Clean", description: "Sans-serif grid, restrained and professional." },
  { id: "elegant", name: "Elegant", description: "Serif type, thin rules and plenty of white space." },
  { id: "bold", name: "Bold", description: "Huge condensed type, diagonal blocks, high contrast." },
  { id: "warm", name: "Warm", description: "Rounded shapes and soft gradients, friendly and inviting." },
  { id: "playful", name: "Playful", description: "Stickers, tilted chips and bright shapes." },
];

export function isPackId(value: unknown): value is PackId {
  return typeof value === "string" && PACKS.some((p) => p.id === value);
}

const TONE_PACK: Record<string, PackId> = { luxury: "elegant", caring: "elegant", bold: "bold", playful: "playful" };

// Industries with a strong look of their own. Matched on the industry name (Business.industry),
// which is one of lib/content/site.ts industries or free text.
const INDUSTRY_PACKS: [RegExp, PackId][] = [
  [/beauty|salon|spa\b|hair|nail|cosmetic|barber|makeup|wellness/i, "elegant"],
  [/fitness|gym|sport|crossfit|martial|boxing/i, "bold"],
  [/restaurant|caf[eé]|bakery|food|coffee|catering|bar\b|kitchen|hotel|hospitality|travel/i, "warm"],
];

/**
 * The pack that fits a business. A distinctive brand voice (luxury, caring, bold, playful) decides;
 * otherwise a strongly styled industry does; then the generic voices (friendly is warm,
 * professional is clean); everything else is clean.
 */
export function recommendPack(business: { tone?: string | null; industry?: string | null }): PackId {
  const tone = business.tone ?? "";
  if (TONE_PACK[tone]) return TONE_PACK[tone];
  const industry = business.industry ?? "";
  const byIndustry = INDUSTRY_PACKS.find(([re]) => re.test(industry));
  if (byIndustry) return byIndustry[1];
  if (tone === "friendly") return "warm";
  return "clean";
}
