// The address of a link-in-bio page: bupulse.com/b/<slug>. Pure, so the settings form, the server action and the
// tests agree. The database checks the same shape (migration 20261026100000_link_in_bio_and_testimonials).

export const SLUG_MIN = 3;
export const SLUG_MAX = 30;

const SHAPE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/**
 * Names nobody may take: they could pass for BuPulse itself, a support desk or an official account, or they are
 * words people would expect to be pages of the site.
 */
export const RESERVED_SLUGS = new Set([
  "admin", "administrator", "api", "app", "apps", "auth", "b", "billing", "blog", "bupulse", "bu-pulse", "contact",
  "dashboard", "demo", "help", "helpdesk", "home", "info", "login", "logout", "mail", "me", "momo", "mtn", "new",
  "news", "null", "official", "owner", "pay", "payment", "payments", "pricing", "privacy", "root", "security",
  "settings", "shop", "signup", "staff", "static", "status", "store", "support", "team", "terms", "test", "undefined",
  "verify", "verified", "webmaster", "widget", "www",
]);

/** "Kigali Shoes & Bags Ltd." -> "kigali-shoes-bags-ltd". May be shorter than SLUG_MIN or reserved: check it. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** What is wrong with an address, in words, or null when it can be used (still subject to being free). */
export function slugProblem(slug: string): string | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return `Use ${SLUG_MIN} to ${SLUG_MAX} letters, numbers or dashes.`;
  if (!SHAPE.test(slug)) return "Use only small letters (a to z), numbers and dashes, with no dash at the start or end.";
  if (slug.includes("--")) return "Use one dash at a time.";
  if (RESERVED_SLUGS.has(slug) || slug.startsWith("bupulse")) return "That address is kept for BuPulse. Try your business name.";
  return null;
}

/** A first address to suggest from the business name (it may be taken: the server tries a number after it). */
export function suggestSlug(name: string): string {
  const base = slugify(name);
  if (!slugProblem(base)) return base;
  const padded = slugify(`${base || "shop"}-rw`);
  return slugProblem(padded) ? "my-shop" : padded;
}
