// The public application page of a campaign is /c/<slug> (docs/CREATOR_CAMPAIGNS.md, "Applying"). Slugs are made from
// the campaign's name: lowercase letters, digits and dashes, unique across all companies. Pure: the caller says which
// slugs are taken, so the tests need no database.

/** Lowercase letters, digits and dashes, from a campaign name ("Kigali Summer Challenge!" → "kigali-summer-challenge"). */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** True for a slug this code could have made (the public page refuses anything else before reading the database). */
export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 60;
}

const suffix = () => Math.random().toString(36).slice(2, 7).padEnd(5, "0");

/** The name's slug, or the slug with a short random ending when it is taken (or too short to be one alone). */
export async function uniqueSlug(name: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(name) || "campaign";
  if (base.length >= 3 && !(await taken(base))) return base;
  for (let i = 0; i < 8; i++) {
    const slug = `${base}-${suffix()}`;
    if (!(await taken(slug))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}
