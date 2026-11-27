// The site banner: one announcement bar above the menu on every public page (owner's request of 27 Nov 2026). The owner
// edits it in Admin -> Settings -> Site banner: the words (computer and phone), colour, font, animation, an optional
// countdown and what happens when it ends, when it shows (from / until), its button, and whether the site's main
// button counts down too. It is separate from the waiting list (lib/waitlist.ts), which closes sign-ups: the banner
// can announce anything. Stored as one AdminSetting (`site.banner`). Pure, so Admin, the public pages and the tests agree.

export const BANNER_COLORS = ["brand", "red", "orange", "black", "green", "gold", "custom"] as const;
export type BannerColor = (typeof BANNER_COLORS)[number];

export const BANNER_FONTS = ["default", "bold", "elegant", "handwritten", "mono"] as const;
export type BannerFont = (typeof BANNER_FONTS)[number];

export const BANNER_ANIMATIONS = ["none", "slide", "shimmer", "pulse", "scroll"] as const;
export type BannerAnimation = (typeof BANNER_ANIMATIONS)[number];

/** Big festive icons on the banner: a tree before the message and a gift by the timer, or rocket and sparkles. */
export const BANNER_DECORS = ["christmas", "launch", "none"] as const;
export type BannerDecor = (typeof BANNER_DECORS)[number];

/** What the banner shows once its countdown reaches zero. */
export const BANNER_ENDINGS = ["text", "keep", "hide"] as const;
export type BannerEnding = (typeof BANNER_ENDINGS)[number];

/** The banner's own button. */
export const BANNER_BUTTONS = ["quote", "link", "none"] as const;
export type BannerButton = (typeof BANNER_BUTTONS)[number];

/** The site's main button (header and home page) while the banner shows. */
export const HEADER_BUTTONS = ["normal", "countdown", "pulse"] as const;
export type HeaderButton = (typeof HEADER_BUTTONS)[number];

export type SiteBanner = {
  on: boolean;
  /** The message on computers. */
  text: string;
  /** A shorter message for phones; empty = the computer message. */
  mobileText: string;
  color: BannerColor;
  /** "#rrggbb", used when color is "custom". */
  customColor: string;
  font: BannerFont;
  animation: BannerAnimation;
  decor: BannerDecor;
  /** The countdown's end as an ISO instant, or null for no countdown. */
  countdownAt: string | null;
  whenEnded: BannerEnding;
  /** Shown instead of the message when the countdown ended and whenEnded is "text". */
  endedText: string;
  /** The banner shows from this instant (null = now) until this one (null = until switched off). */
  showFrom: string | null;
  hideAfter: string | null;
  button: BannerButton;
  buttonLabel: string;
  /** For button "link": a site path (/pricing) or a full https:// address. */
  buttonUrl: string;
  headerButton: HeaderButton;
  /** The site's main button wears the banner's colour, and the BuPulse colour on hover (owner, 27 Nov 2026). */
  matchButton: boolean;
};

export const LIMITS = { text: 160, mobileText: 90, endedText: 160, buttonLabel: 30, buttonUrl: 300 } as const;

/** The waiting list's Christmas banner (owner's wording of 27 Nov 2026), counting down to 00:00 Kigali on 15 Dec. */
export const DEFAULT_BANNER: SiteBanner = {
  on: false,
  text: "This Christmas, your business gets its own AI marketing team. Launching 15 Dec.",
  mobileText: "Your own AI marketing team this Christmas. Launching 15 Dec.",
  // Gold, to feel like Christmas (owner, 27 Nov 2026), with the big tree and gift.
  color: "gold",
  customColor: "#d91f26",
  font: "default",
  animation: "none",
  decor: "christmas",
  countdownAt: "2026-12-14T22:00:00.000Z",
  whenEnded: "text",
  endedText: "BuPulse is launching. Your AI marketing team is almost here.",
  showFrom: null,
  hideAfter: null,
  button: "quote",
  buttonLabel: "Reserve your spot",
  buttonUrl: "",
  headerButton: "countdown",
  matchButton: true,
};

export class BannerError extends Error {}

const oneOf = <T extends string>(list: readonly T[], v: unknown, what: string): T => {
  if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T;
  throw new BannerError(`Choose ${what}.`);
};

const words = (v: unknown, max: number, what: string, required: boolean): string => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (required && !s) throw new BannerError(`Write ${what}.`);
  if (s.length > max) throw new BannerError(`Keep ${what} under ${max} characters (now ${s.length}).`);
  return s;
};

const instant = (v: unknown, what: string): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new BannerError(`${what} is not a date and time.`);
  return d.toISOString();
};

/** A safe link for the banner button: a site path or an https:// address. */
export function cleanBannerUrl(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.length > LIMITS.buttonUrl) throw new BannerError("The button link is too long.");
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.protocol === "https:") return url.toString();
  } catch {
    // falls through
  }
  throw new BannerError("The button link must be a page of the site (like /pricing) or a full https:// address.");
}

/** Checks a banner from the Admin form (or the database) and returns it in its stored shape. Throws BannerError. */
export function cleanSiteBanner(raw: unknown): SiteBanner {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const color = oneOf(BANNER_COLORS, r.color, "a colour");
  const customColor = String(r.customColor ?? "").trim().toLowerCase();
  if (color === "custom" && !/^#[0-9a-f]{6}$/.test(customColor)) throw new BannerError("Pick your own colour, like #d91f26.");
  const button = oneOf(BANNER_BUTTONS, r.button, "what the banner button does");
  const buttonUrl = cleanBannerUrl(r.buttonUrl);
  if (button === "link" && !buttonUrl) throw new BannerError("Add the link the banner button opens.");
  const whenEnded = oneOf(BANNER_ENDINGS, r.whenEnded, "what happens when the countdown ends");
  const showFrom = instant(r.showFrom, "Show from");
  const hideAfter = instant(r.hideAfter, "Hide after");
  if (showFrom && hideAfter && hideAfter <= showFrom) throw new BannerError("“Hide after” must be later than “Show from”.");
  return {
    on: r.on === true || r.on === "on" || r.on === "true",
    text: words(r.text, LIMITS.text, "the message", true),
    mobileText: words(r.mobileText, LIMITS.mobileText, "the phone message", false),
    color,
    customColor: /^#[0-9a-f]{6}$/.test(customColor) ? customColor : DEFAULT_BANNER.customColor,
    font: oneOf(BANNER_FONTS, r.font, "a font"),
    animation: oneOf(BANNER_ANIMATIONS, r.animation, "an animation"),
    // Older saved banners have no value: Christmas, like the default.
    decor: r.decor === undefined ? "christmas" : oneOf(BANNER_DECORS, r.decor, "a decoration"),
    countdownAt: instant(r.countdownAt, "The countdown"),
    whenEnded,
    endedText: words(r.endedText, LIMITS.endedText, "the message after the countdown", whenEnded === "text"),
    showFrom,
    hideAfter,
    button,
    buttonLabel: words(r.buttonLabel, LIMITS.buttonLabel, "the button's words", button !== "none"),
    buttonUrl,
    headerButton: oneOf(HEADER_BUTTONS, r.headerButton, "how the main button behaves"),
    // Older saved banners have no value: on, like the default.
    matchButton: r.matchButton === undefined ? true : r.matchButton === true || r.matchButton === "on" || r.matchButton === "true",
  };
}

/** The stored banner, or the default when nothing (or something unreadable) is stored. */
export function readSiteBanner(raw: unknown): SiteBanner {
  if (raw === undefined || raw === null) return DEFAULT_BANNER;
  try {
    return cleanSiteBanner(raw);
  } catch {
    return DEFAULT_BANNER;
  }
}

/** True when the banner should be on the page at `now`: switched on, inside its show-from / hide-after window, and not
 *  past a countdown that hides it. */
export function bannerShowing(b: SiteBanner, now: number = Date.now()): boolean {
  if (!b.on) return false;
  if (b.showFrom && now < new Date(b.showFrom).getTime()) return false;
  if (b.hideAfter && now >= new Date(b.hideAfter).getTime()) return false;
  // "Hide the banner" when the countdown ends: gone from the page too, not only from browsers that had it open.
  if (b.whenEnded === "hide" && b.countdownAt && now >= new Date(b.countdownAt).getTime()) return false;
  return true;
}

/** The banner's background and text colour as CSS values (for the main button that wears the banner's colour). */
export function bannerPaint(b: Pick<SiteBanner, "color" | "customColor">): { bg: string; fg: string } {
  switch (b.color) {
    case "brand":
      return { bg: "linear-gradient(120deg, #2f6bff, #7b5cff)", fg: "#ffffff" };
    case "red":
      return { bg: "#d91f26", fg: "#ffffff" };
    case "orange":
      return { bg: "#ff7a1a", fg: "#1a1006" };
    case "black":
      return { bg: "#0b0b0f", fg: "#ffffff" };
    case "green":
      return { bg: "#0f7a3d", fg: "#ffffff" };
    case "gold":
      return { bg: "#f5b70a", fg: "#1a1206" };
    case "custom":
      return { bg: b.customColor, fg: textOn(b.customColor) === "light" ? "#ffffff" : "#111111" };
  }
}

/** Text on a custom colour: dark on light backgrounds, white on dark ones (WCAG relative luminance). */
export function textOn(hex: string): "dark" | "light" {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with white (1.05 / (l + 0.05)) against contrast with near-black ((l + 0.05) / 0.06).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.06 ? "light" : "dark";
}

// Kigali is UTC+2 all year. The Admin form's date-and-time boxes are in Kigali time.
const KIGALI_MS = 2 * 3_600_000;

/** "2026-12-15T00:00" (Kigali, from <input type="datetime-local">) as an ISO instant; "" stays null. */
export function kigaliLocalToIso(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return v.trim() ? "invalid" : null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi) - KIGALI_MS;
  const check = new Date(t + KIGALI_MS);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return "invalid";
  return new Date(t).toISOString();
}

/** An ISO instant as "2026-12-15T00:00" in Kigali time, for the form; null gives "". */
export function isoToKigaliLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + KIGALI_MS);
  return d.toISOString().slice(0, 16);
}

/**
 * The banner from the Admin form's fields (FormData.get), before checking: the date-and-time boxes are Kigali time and
 * the countdown only counts when its box is ticked. A badly typed date comes back as "invalid" so the check names it.
 */
export function bannerFromForm(get: (name: string) => string | null): Record<string, unknown> {
  const v = (k: string) => get(k) ?? "";
  return {
    on: get("on") === "on",
    text: v("text"),
    mobileText: v("mobileText"),
    color: v("color"),
    customColor: v("customColor"),
    font: v("font"),
    animation: v("animation"),
    decor: v("decor"),
    countdownAt: get("countdownOn") === "on" ? kigaliLocalToIso(v("countdownAt")) : null,
    whenEnded: v("whenEnded"),
    endedText: v("endedText"),
    showFrom: kigaliLocalToIso(v("showFrom")),
    hideAfter: kigaliLocalToIso(v("hideAfter")),
    button: v("button"),
    buttonLabel: v("buttonLabel"),
    buttonUrl: v("buttonUrl"),
    headerButton: v("headerButton"),
    matchButton: get("matchButton") === "on",
  };
}
