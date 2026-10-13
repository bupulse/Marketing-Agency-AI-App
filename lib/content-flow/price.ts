// The price choice of "Create today's content" (docs/CONTENT.md): "AI decides" (at most about 1 post in 4 shows the
// price, never two price posts in a row for a subject), "With price" (every post states it, so the subject needs one)
// or "No price (engaging)" (no price in captions or designs). Pure.

export type PriceChoice = "auto" | "with" | "none";
export const PRICE_CHOICES: readonly PriceChoice[] = ["auto", "with", "none"];
export const PRICE_CHOICE_LABEL: Record<PriceChoice, string> = { auto: "AI decides", with: "With price", none: "No price (engaging)" };

/** The numbers of a price label ("15,000 RWF" -> ["15000"]); none for "On request". */
export function priceNumbers(price: string | null | undefined): string[] {
  return (price?.match(/\d[\d,.\s]*\d|\d/g) ?? []).map((n) => n.replace(/[,.\s]/g, "")).filter((n) => n.length >= 2 || Number(n) > 0);
}

/** Whether a text states the price (one of its numbers, written with or without separators). */
export function mentionsPrice(text: string, price: string | null | undefined): boolean {
  const wanted = priceNumbers(price);
  if (wanted.length === 0) return false;
  const found = (text.match(/\d[\d,.\s]*\d|\d/g) ?? []).map((n) => n.replace(/[,.\s]/g, ""));
  return found.some((n) => wanted.includes(n));
}

/** The text without the sentences (or lines) that state the price. */
export function stripPrice(text: string, price: string | null | undefined): string {
  if (!mentionsPrice(text, price)) return text;
  const parts = text.split(/(?<=[.!?])\s+|\n/);
  return parts.filter((p) => !mentionsPrice(p, price)).join(" ").replace(/[ \t]{2,}/g, " ").trim();
}

/** A product or campaign block without its price lines (for "No price"). */
export function withoutPriceLines(context: string | null | undefined): string | null {
  if (!context) return context ?? null;
  return context
    .split("\n")
    .filter((l) => !/^\s*-?\s*(price|price or offer|pricing|offer|cost|discount)\b/i.test(l))
    .join("\n");
}

/** Recent posts of a subject, newest first: did each show the price? */
export type PriceHistory = readonly boolean[];

/**
 * Which of this run's posts may show the price. "with": all. "none": none. "auto": at most one, and only when none of
 * the subject's last 3 posts showed it (so at most about 1 in 4, never two in a row); the price angle's post gets it.
 */
export function priceSlots(choice: PriceChoice, angles: readonly string[], history: PriceHistory, hasPrice: boolean): boolean[] {
  if (!hasPrice || choice === "none") return angles.map(() => false);
  if (choice === "with") return angles.map(() => true);
  const recentPrice = history.slice(0, 3).some(Boolean);
  if (recentPrice) return angles.map(() => false);
  const i = angles.indexOf("price");
  return angles.map((_, k) => k === i);
}

/** Whether "AI decides" may pick the price angle at all for this run. */
export function priceAngleAllowed(choice: PriceChoice, history: PriceHistory, hasPrice: boolean): boolean {
  return hasPrice && choice !== "none" && (choice === "with" || !history.slice(0, 3).some(Boolean));
}
