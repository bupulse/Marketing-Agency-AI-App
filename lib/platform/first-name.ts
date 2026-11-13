// The first name a client is greeted with outside the dashboard (the service chooser, /apps). Pure, so it is tested.

/**
 * The name saved in Settings wins, as in the dashboard's "Welcome back" (components/app/context.ts); a Google sign-up
 * starts with its Google name. QA 13 Nov: the chooser read only the sign-in's metadata and greeted LEAF's owner as
 * "Bupulse" while the dashboard said "Euzeb".
 */
export function greetingFirstName(savedName: string | null | undefined, meta: { full_name?: string; name?: string; ceo_name?: string } | undefined): string | null {
  const full = (savedName?.trim() || meta?.full_name || meta?.name || meta?.ceo_name || "").trim();
  return full.split(/\s+/)[0] || null;
}
