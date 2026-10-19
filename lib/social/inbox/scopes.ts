// The extra Meta permissions the direct route needs to read and answer comments and DMs. They are asked for only on
// connections made with BuPulse's own Meta app, and only once the Admin switch says "Meta direct": until Meta approves
// them (Advanced Access needs a registered business), asking for them would block every sign-in, so today's
// connections keep asking exactly what they ask now. docs/SOCIAL_INBOX.md, docs/META_APP_REVIEW.md.

import type { InboxTransport } from "./settings";

export const INBOX_SCOPES = {
  /** Instagram Login (graph.instagram.com). */
  instagram: ["instagram_business_manage_messages", "instagram_business_manage_comments"],
  /** Instagram through Facebook Login (Page token). */
  instagramViaFacebook: ["instagram_manage_comments", "instagram_manage_messages", "pages_messaging", "pages_manage_metadata"],
  /** Facebook Pages. */
  facebook: ["pages_messaging", "pages_manage_metadata"],
} as const;

/** The extra scopes for a direct sign-in, or none while the inbox uses BuPulse-Socials. */
export function inboxScopesFor(network: string, variant: string | undefined, transport: InboxTransport): string[] {
  if (transport !== "meta") return [];
  if (network === "facebook") return [...INBOX_SCOPES.facebook];
  if (network === "instagram") return variant === "facebook" ? [...INBOX_SCOPES.instagramViaFacebook] : [...INBOX_SCOPES.instagram];
  return [];
}
