// What must never travel from one business's example into another business's prompt (docs/TRAINING_LAB.md): phone
// numbers, links, emails and prices. The Lab's examples come from many businesses' reels, so every line that goes into a
// prompt, and the notes written when an edit is saved, are scrubbed with this. Brand and product names cannot be found
// reliably; the prompts carry a fixed warning about them instead. Pure.

const URL = /https?:\/\/\S+|www\.\S+/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
// "45,000 RWF", "45 000 frw", "45k RWF", "1.2M francs", "RWF 45k", "Frw 45,000", "$45".
const AMOUNT = String.raw`\d[\d,.\s]*\d(?:\s?[kKmM]\b)?|\d(?:\s?[kKmM]\b)?`;
const PRICE = new RegExp(String.raw`\b(?:rwf|frw|rfw|fr)\.?\s*(?:${AMOUNT})|(?:${AMOUNT})\s*(?:rwf|frw|rfw|francs?|fr)\b|\$\s?(?:${AMOUNT})`, "giu");

/** Links, emails and phone numbers swapped for {website}, {email} and {phone} (what the viral rows have always done, plus emails). */
export function scrubContact(text: string): string {
  return text.replace(URL, "{website}").replace(EMAIL, "{email}").replace(PHONE, "{phone}");
}

/** Prices first (so "45 000 RWF" is not taken for a phone number), then links, emails and phone numbers. */
export function scrubText(text: string): string {
  return scrubContact(text.replace(PRICE, "{price}"));
}
