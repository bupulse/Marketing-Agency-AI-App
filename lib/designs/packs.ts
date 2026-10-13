// Brand style packs: metadata and the automatic choice. Client-safe (no rendering code), so the
// studio can list the packs and mark the one that matches the business.
export type PackId = "elegant" | "bold" | "warm" | "clean" | "playful" | "minimal" | "luxe" | "vibrant" | "earthy" | "corporate" | "fresh" | "retro";

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
  { id: "minimal", name: "Minimal", description: "Quiet type, one accent and a lot of empty space." },
  { id: "luxe", name: "Luxe", description: "Deep tones, gold rules and refined serif type." },
  { id: "vibrant", name: "Vibrant", description: "Saturated colour blocks, big geometric type, pop energy." },
  { id: "earthy", name: "Earthy", description: "Warm earth tones, woven patterns and serif type, grounded and handmade." },
  { id: "corporate", name: "Corporate", description: "Technical grotesk type, grids and data-like details." },
  { id: "fresh", name: "Fresh", description: "Light greens and tints, leaves and rounded type, natural and healthy." },
  { id: "retro", name: "Retro", description: "Cream paper, sunbursts, badges and offset shadows." },
];

export function isPackId(value: unknown): value is PackId {
  return typeof value === "string" && PACKS.some((p) => p.id === value);
}

// Industries with a strong look of their own. Matched on the industry name (Business.industry),
// which is one of lib/content/site.ts industries or free text. First match wins.
const INDUSTRY_PACKS: [RegExp, PackId][] = [
  [/jewel|gold\b|watch(es)?\b|perfume|fragrance|luxury|couture|boutique hotel|villa/i, "luxe"],
  [/barber|vintage|thrift|retro|antique|second[- ]hand|vinyl|record shop|diner/i, "retro"],
  [/beauty|salon|spa\b|hair|nail|cosmetic|makeup|wellness/i, "elegant"],
  [/fitness|gym|sport|crossfit|martial|boxing/i, "bold"],
  [/restaurant|caf[eé]|bakery|food|coffee|catering|bar\b|kitchen/i, "warm"],
  [/hotel|hospitality|travel|tour|safari|lodge|craft|handmade|textile|fabric|tailor|pottery|basket|furniture|d[eé]cor|interior/i, "earthy"],
  [/farm|agri|organic|grocer|vegetable|fruit|juice|clinic|health|medical|dental|pharma|nutrition|eco\b|garden/i, "fresh"],
  [/kid|toy|party|entertainment|music|club|game|candy|ice cream|school|training|education/i, "vibrant"],
  [/architect|photograph|gallery|studio|design agency|minimal/i, "minimal"],
  [/software|\bit\b|tech|phone|electronic|computer|telecom|consult|account|financ|bank|insurance|law|legal|logistic|engineer|construction|machinery|equipment/i, "corporate"],
];

// Voices that pick the pack on their own; luxury and caring look at the industry first.
const TONE_PACK: Record<string, PackId> = { bold: "bold", playful: "playful" };

/**
 * The pack that fits a business. A bold or playful voice decides; a luxury voice is luxe for jewellery, fashion,
 * hotels and property, else elegant; a caring voice is fresh for health and food growers, else elegant. Then a
 * strongly styled industry; then the generic voices (friendly is warm, professional is clean); everything else clean.
 */
export function recommendPack(business: { tone?: string | null; industry?: string | null }): PackId {
  const tone = business.tone ?? "";
  const industry = business.industry ?? "";
  const byIndustry = INDUSTRY_PACKS.find(([re]) => re.test(industry))?.[1];
  if (TONE_PACK[tone]) return TONE_PACK[tone];
  if (tone === "luxury") return byIndustry === "luxe" || /real estate|propert|hotel|fashion|boutique/i.test(industry) ? "luxe" : "elegant";
  if (tone === "caring") return byIndustry === "fresh" ? "fresh" : "elegant";
  // A professional voice keeps tech and services corporate or clean even where the industry is playful.
  if (tone === "professional" && byIndustry === "vibrant") return "clean";
  if (byIndustry) return byIndustry;
  if (tone === "friendly") return "warm";
  return "clean";
}
