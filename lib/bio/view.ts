// What a link-in-bio page shows, from the company's data (BioSource, built on the server by lib/bio/source.ts) and the
// owner's choices (BioSettings). Pure and light (no phone library), so the dashboard's live preview runs it in the
// browser while the owner edits, and the public page runs the same code.
import { z } from "zod";
import { slugProblem } from "./slug";

export const BIO_LINK_TYPES = ["website", "instagram", "tiktok", "facebook"] as const;
export type BioLinkType = (typeof BIO_LINK_TYPES)[number];
export const BIO_LINK_LABEL: Record<BioLinkType, string> = { website: "Website", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" };

export const MAX_BIO_PRODUCTS = 12;
export const BIO_LIMITS = { tagline: 120, message: 300, landmark: 160 } as const;

/** The owner's choices, as the settings form edits them. Empty text means "use the default". */
export type BioSettings = {
  enabled: boolean;
  slug: string;
  tagline: string;
  /** E.164 of the WhatsApp button (one of the business's WhatsApp numbers), or null for no button. */
  whatsapp: string | null;
  message: string;
  /** E.164 of the Call button, or null. */
  phone: string | null;
  /** The address of the place shown (one of the business's locations), or null. */
  location: string | null;
  landmark: string;
  showHours: boolean;
  links: BioLinkType[];
  /** Products and services shown, in order. */
  productIds: string[];
};

/** What the company has that a page can show, already formatted. Only what the settings pick reaches the page. */
export type BioSource = {
  name: string;
  /** The Company profile's tagline, else the description: the line shown when the owner writes none. */
  defaultTagline: string;
  accent: string;
  logoUrl: string | null;
  whatsappNumbers: { value: string; display: string }[];
  phoneNumbers: { value: string; display: string }[];
  locations: { address: string; label: string; text: string; mapsUrl: string }[];
  /** Null when the business has no opening hours. `status` is "Open now until 18:00" when the time zone is known. */
  hours: { lines: string[]; status: string | null; open: boolean | null } | null;
  links: { type: BioLinkType; href: string; display: string }[];
  products: { id: string; name: string; price: string; summary: string; photoUrl: string | null }[];
};

export type BioView = {
  name: string;
  initial: string;
  tagline: string | null;
  logoUrl: string | null;
  accent: string;
  whatsapp: { href: string } | null;
  call: { href: string; display: string } | null;
  place: { label: string; text: string; landmark: string | null; mapsUrl: string } | null;
  hours: { lines: string[]; status: string | null; open: boolean | null } | null;
  links: { type: BioLinkType; label: string; href: string; display: string }[];
  items: { id: string; name: string; price: string; summary: string; photoUrl: string | null; askHref: string | null }[];
};

const text = (max: number, label: string) => z.string().trim().max(max, `Please keep the ${label} under ${max} characters.`);

export const bioSettingsSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().max(60),
  tagline: text(BIO_LIMITS.tagline, "line under your name"),
  whatsapp: z.string().max(20).nullable(),
  message: text(BIO_LIMITS.message, "WhatsApp message"),
  phone: z.string().max(20).nullable(),
  location: z.string().max(400).nullable(),
  landmark: text(BIO_LIMITS.landmark, "landmark"),
  showHours: z.boolean(),
  links: z.array(z.enum(BIO_LINK_TYPES)).max(BIO_LINK_TYPES.length),
  productIds: z.array(z.string().min(1).max(40)).max(MAX_BIO_PRODUCTS, `Show up to ${MAX_BIO_PRODUCTS} products or services.`),
});

export type BioSettingsResult = { ok: true; data: BioSettings } | { ok: false; errors: Record<string, string> };

/** Checks the settings form (shape, lengths, the address). Whether the numbers and products are the company's is the server's check. */
export function validateBioSettings(input: unknown): BioSettingsResult {
  const parsed = bioSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, errors };
  }
  const d = parsed.data;
  const slug = slugProblem(d.slug);
  if (slug) return { ok: false, errors: { slug } };
  return { ok: true, data: { ...d, links: BIO_LINK_TYPES.filter((t) => d.links.includes(t)), productIds: [...new Set(d.productIds)] } };
}

/** The app a visitor came from, read from the in-app browser's user agent: the greeting then names it. */
export function platformOf(userAgent: string | null | undefined): "Instagram" | "TikTok" | "Facebook" | null {
  const ua = userAgent ?? "";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/musical_ly|TikTok|BytedanceWebview|trill/i.test(ua)) return "TikTok";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  return null;
}

/** "Hello, I saw your page on Instagram." when the app is known, else "Hello, I saw your page." */
export function defaultMessage(platform: string | null): string {
  return platform ? `Hello, I saw your page on ${platform}.` : "Hello, I saw your page.";
}

/** https://wa.me/250788123456?text=... (digits of the E.164 number only). */
export function whatsAppHref(e164: string, message: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/** The page: only what the settings pick and the company still has (a number removed from Business info disappears). */
export function buildBioView(source: BioSource, settings: BioSettings, opts: { platform?: string | null } = {}): BioView {
  const wa = settings.whatsapp ? source.whatsappNumbers.find((n) => n.value === settings.whatsapp) : undefined;
  const call = settings.phone ? source.phoneNumbers.find((n) => n.value === settings.phone) : undefined;
  const place = settings.location ? source.locations.find((l) => l.address === settings.location) : undefined;
  const message = settings.message.trim() || defaultMessage(opts.platform ?? null);
  const products = new Map(source.products.map((p) => [p.id, p]));
  return {
    name: source.name,
    initial: (source.name.trim()[0] ?? "B").toUpperCase(),
    tagline: settings.tagline.trim() || source.defaultTagline.trim() || null,
    logoUrl: source.logoUrl,
    accent: source.accent,
    whatsapp: wa ? { href: whatsAppHref(wa.value, message) } : null,
    call: call ? { href: `tel:+${call.value.replace(/\D/g, "")}`, display: call.display } : null,
    place: place ? { label: place.label, text: place.text, landmark: settings.landmark.trim() || null, mapsUrl: place.mapsUrl } : null,
    hours: settings.showHours ? source.hours : null,
    links: source.links.filter((l) => settings.links.includes(l.type)).map((l) => ({ ...l, label: BIO_LINK_LABEL[l.type] })),
    items: settings.productIds.flatMap((id) => {
      const p = products.get(id);
      if (!p) return [];
      return [{ ...p, askHref: wa ? whatsAppHref(wa.value, `${message} I would like to ask about: ${p.name}.`) : null }];
    }),
  };
}
