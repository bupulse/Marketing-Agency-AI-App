// Where a quote request came from, and the page it was sent from. Pure and without the phone library, so the pop-up
// in the browser can use it too.

export const QUOTE_KIND = "quote";

/** The pop-up's source when the page address names none: it was opened somewhere on the website. */
export const POPUP_SOURCE = "website";
/** /quote opened without ?src= (typed in, or a link without a tag). */
export const QUOTE_PAGE_SOURCE = "quote_page";

/** Short names people put in links, and what they mean. */
const SOURCE_ALIASES: Record<string, string> = { ig: "instagram", insta: "instagram", fb: "facebook", meta: "facebook", wa: "whatsapp", tt: "tiktok", yt: "youtube", li: "linkedin", x: "twitter" };

/**
 * A link's ?src= (or utm_source) as a short tag: "Instagram" and "ig" are both "instagram". Letters, digits, - and _
 * only, at most 40 characters; anything else gives `fallback`.
 */
export function cleanQuoteSource(raw: string | null | undefined, fallback: string = POPUP_SOURCE): string {
  const v = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!v || v.length > 40 || !/^[a-z0-9][a-z0-9_-]*$/.test(v)) return fallback;
  return SOURCE_ALIASES[v] ?? v;
}

/**
 * The page a request was sent from, as a site path with its query ("/pricing?src=instagram"). A full address of this
 * site becomes its path; anything that is not a path (another site, a script) gives null. At most 500 characters.
 */
export function cleanPagePath(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  try {
    const url = new URL(v, "https://bupulse.invalid");
    if (!/^https?:$/.test(url.protocol)) return null;
    // A relative path resolves against the placeholder origin; a full address keeps only its path and query.
    if (url.origin === "https://bupulse.invalid" && !v.startsWith("/")) return null;
    const path = `${url.pathname}${url.search}`;
    return path.startsWith("/") && !path.startsWith("//") ? path.slice(0, 500) : null;
  } catch {
    return null;
  }
}
