// Tracked links (docs/SUPPORT_DASHBOARD.md "Tracked links"): bupulse.com/go/<code>. Pure, no imports: the support app's
// form, the /go route and the tests share it.

/** Where a link is shared. The key becomes the visit's source (utm_source), so Analytics groups it with that site. */
export const CHANNELS = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "tiktok", label: "TikTok" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "x", label: "X (Twitter)" },
  { key: "youtube", label: "YouTube" },
  { key: "google", label: "Google (ads, Business Profile)" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "print", label: "Print, poster, QR code" },
  { key: "other", label: "Other" },
] as const;

export type ChannelKey = (typeof CHANNELS)[number]["key"];

export const isChannel = (v: unknown): v is ChannelKey => CHANNELS.some((c) => c.key === v);
export const channelLabel = (key: string): string => CHANNELS.find((c) => c.key === key)?.label ?? key;

/** Pages a link can open. "Other page" in the form takes any path of the site. */
export const DESTINATIONS = [
  { path: "/", label: "Home page" },
  { path: "/pricing", label: "Pricing" },
  { path: "/quote", label: "Get a free quote" },
  { path: "/signup", label: "Sign up" },
] as const;

/** A site path a link may open: starts with one "/", no address of another site, at most 200 characters, no #. */
export function cleanDestination(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || v.length > 200) return null;
  if (/[\u0000-\u001f\u007f\s#]/.test(v)) return null;
  // The admin console, the support app and the APIs are never a link's page.
  if (/^\/(admin|api|support|go|dashboard)(\/|$|\?)/.test(v)) return null;
  return v;
}

export const CODE_RULE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

/** A code as typed ("IG Bio" → "ig-bio"), or null when it cannot be one (3 to 40 of a-z, 0-9 and -). */
export function normalizeCode(raw: unknown): string | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return CODE_RULE.test(v) ? v : null;
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A code made from the label and a short random tail, for when none is typed: "Jean WhatsApp" → "jean-whatsapp-7k2q". */
export function codeFromLabel(label: string, random: () => number = Math.random): string {
  const base = (normalizeCode(label) ?? "link").slice(0, 30).replace(/-+$/g, "");
  const tail = Array.from({ length: 4 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
  return `${base}-${tail}`;
}

/** The cookie that remembers the last tracked link a visitor came through (its id), for 30 days. */
export const LINK_COOKIE = "bp-link";
export const LINK_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Where /go/<code> sends the visitor: the link's page with utm tags (source = channel, medium = link, campaign = code)
 * and ?src= (the quote form's source), added to any query the page already has; tags already there are kept.
 */
export function landingUrl(link: { destination: string; channel: string; code: string }, origin: string): URL {
  const url = new URL(link.destination, origin);
  const set = (k: string, v: string) => {
    if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  };
  set("utm_source", link.channel);
  set("utm_medium", "link");
  set("utm_campaign", link.code);
  set("src", link.channel);
  return url;
}

/** The full short link people share. */
export const shortLink = (origin: string, code: string): string => `${origin.replace(/\/$/, "")}/go/${code}`;

/**
 * Whose lead a visitor is (the owner, 10 November 2026). Visitors from Google, Facebook and every other channel, and
 * from the company's own links (made by admin@bupulse.com), are the company's. They are a staff member's lead when they
 * came through that person's own link, or when a staff member talked to them in the chat (the first one who replied).
 * A staff link wins over a chat with someone else.
 */
export type LeadOwner = { kind: "company" } | { kind: "staff"; agentId: string; name: string; via: "link" | "chat" };

export type LeadLink = { byId: string | null; byName: string | null; byOwner: boolean };
export type LeadChatAgent = { id: string; name: string; owner: boolean };

export function leadOwnerOf(link: LeadLink | null, chatAgent: LeadChatAgent | null): LeadOwner {
  if (link?.byId && !link.byOwner) return { kind: "staff", agentId: link.byId, name: link.byName ?? "Staff", via: "link" };
  if (chatAgent && !chatAgent.owner) return { kind: "staff", agentId: chatAgent.id, name: chatAgent.name, via: "chat" };
  return { kind: "company" };
}

export const COMPANY_NAME = "BuPulse (company)";

export function leadOwnerText(owner: LeadOwner): string {
  if (owner.kind === "company") return COMPANY_NAME;
  return `${owner.name} (${owner.via === "link" ? "their link" : "talked in the chat"})`;
}
