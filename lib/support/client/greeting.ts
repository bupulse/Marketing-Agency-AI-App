// When the "Need help?" greeting shows (docs/SUPPORT_CHAT.md "Greeting", research 2.1). Pure, so the rules are tested.
import type { Surface, VisitResponse } from "../contract";

export const RECENT_CHAT_MS = 7 * 24 * 60 * 60 * 1000;

// Paid clicks carry one of these; a link-in-bio page sends utm_source=bio.
const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid", "twclid", "li_fat_id"];
const PAID_MEDIUMS = /^(cpc|ppc|paid|paidsocial|paid_social|paid-social|ads?|display|cpm)$/i;

/** Whether the landing page came from an ad or a link-in-bio page: those visitors are still deciding whether to stay. */
export function fromAdOrBio(search: string, referrer: string): boolean {
  const q = new URLSearchParams(search);
  if (CLICK_IDS.some((k) => q.has(k))) return true;
  if (PAID_MEDIUMS.test(q.get("utm_medium") ?? "")) return true;
  if ((q.get("utm_source") ?? "").toLowerCase() === "bio") return true;
  try {
    return /^\/b\/[^/]+/.test(new URL(referrer).pathname);
  } catch {
    return false;
  }
}

export type GreetingInput = {
  greeting: VisitResponse["greeting"];
  surface: Surface;
  isPhone: boolean;
  now: number;
  /** When this visitor last sent a chat message (localStorage), or null. */
  lastChatAt: number | null;
  /** 0 on the first page of the visit. */
  pageIndex: number;
  /** The visit's landing page came from an ad or a bio link. */
  landedFromAdOrBio: boolean;
  /** A conversation is open (resumed or started). */
  chatting: boolean;
  panelOpen: boolean;
  /** Already shown or closed in this visit (sessionStorage). */
  seenThisVisit: boolean;
};

/** "bubble": the text card above the button; "dot": only a dot on the button (phones); null: nothing. */
export function greetingMode(i: GreetingInput): "bubble" | "dot" | null {
  if (!i.greeting || i.surface === "bio") return null;
  if (i.seenThisVisit || i.chatting || i.panelOpen) return null;
  if (i.lastChatAt !== null && i.now - i.lastChatAt < RECENT_CHAT_MS) return null;
  if (i.pageIndex === 0 && i.landedFromAdOrBio) return null;
  return i.isPhone ? "dot" : "bubble";
}
