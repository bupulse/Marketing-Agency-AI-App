// The checks BuPulse makes on every handed-in post (docs/CREATOR_CAMPAIGNS.md, "Checks"). Pure. Check 1 (own account)
// is the link being found on one of the creator's connected accounts (resolve.ts); these are checks 2 and 3, on what
// the network says about the post, and the plain reason shown to the creator when one fails.

import { addDaysYmd } from "@/lib/demo/slots";
import { dayIn } from "../periods";

export type Checks = { ownAccount: boolean | null; onTime: boolean | null; mention: boolean | null };

/** On time: the post's date in the company's timezone is the task's day, or the day before or after. */
export function onTime(postedAt: Date, day: string, timeZone: string): boolean {
  const posted = dayIn(postedAt, timeZone);
  return posted >= addDaysYmd(day, -1) && posted <= addDaysYmd(day, 1);
}

/** A link written for comparing: no scheme, no "www.", no trailing slash, lower case. */
const bareLink = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Mention: the caption contains one of the campaign's mentions, any letter case. "@handle" and "#tag" must stand on
 * their own ("#leaf" does not match "#leafy"); a link matches with or without https:// and www. Empty: no check.
 */
export function hasMention(caption: string | null | undefined, mentions: string[]): boolean {
  const wanted = mentions.map((m) => m.trim()).filter(Boolean);
  if (!wanted.length) return true;
  const text = (caption ?? "").toLowerCase();
  if (!text) return false;
  return wanted.some((m) => {
    const needle = m.toLowerCase();
    if (needle.startsWith("@") || needle.startsWith("#")) {
      for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
        const after = text.slice(at + needle.length, at + needle.length + 2);
        if (!after || !WORD.test([...after][0])) return true;
      }
      return false;
    }
    const link = bareLink(needle);
    return link.length > 0 && text.replace(/https?:\/\//g, "").replace(/(^|[^\p{L}\p{N}.])www\./gu, "$1").includes(link);
  });
}

/** The reason a post fails, in the words the creator sees (null: it passed). */
export function failReason(checks: Checks, mentions: string[], network: string): string | null {
  if (checks.ownAccount === false) return `We could not find this post on the ${network} account you connected. Check the link, and that you posted it from that account.`;
  if (checks.onTime === false) return "This post was not made on the task's day. Post it again on the day and hand in the new link.";
  if (checks.mention === false) return `The caption must include ${mentions.length > 1 ? `one of ${mentions.join(", ")}` : mentions[0]}. Edit the caption on the post, then hand it in again.`;
  return null;
}
