// Where the visitor chat shows (docs/SUPPORT_CHAT.md "1. Where the chat shows"). Pure, so the rules are tested.
import type { Surface } from "../contract";

/**
 * Never the floating chat: Admin, the support app, the full-page chat (it is the chat), link-in-bio pages (they get
 * the "Made with BuPulse" corner link instead), the client's website-chat frame, the sales-room TV and the API.
 */
export const EXCLUDED_PREFIXES = ["/admin", "/support", "/help-chat", "/b", "/widget", "/screen", "/api"] as const;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The surface for a page, or null when the chat must not show there. */
export function chatSurface(pathname: string, host = ""): Surface | null {
  if (/^support\./i.test(host)) return null;
  const path = pathname || "/";
  if (EXCLUDED_PREFIXES.some((p) => under(path, p))) return null;
  if (under(path, "/dashboard")) return "dashboard";
  if (under(path, "/creator")) return "creator";
  return "public";
}

/** Phones get the full-screen chat and never a text bubble over the page. */
export const PHONE_MAX_WIDTH = 480;

export function isPhoneWidth(width: number): boolean {
  return width > 0 && width <= PHONE_MAX_WIDTH;
}
