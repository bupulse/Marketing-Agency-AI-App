// Who a reply goes to, and the subject, for Reply / Reply all / Forward (docs/MAIL_CRM.md "Reading and replying").
// Pure: the composer and the tests share it.

import { isOurAddress, type Addr } from "./addresses";
import { forwardSubject, replySubject } from "./threading";
import type { QuotePreview, ReplyOption } from "./draft-rules";

export type ReplyMode = "reply" | "all" | "forward";

export type ParentMessage = { fromName: string; fromAddress: string; replyTo: string | null; to: Addr[]; cc: Addr[]; subject: string; direction: string };

const uniq = (list: Addr[], skip: Set<string>) => {
  const out: Addr[] = [];
  for (const a of list) {
    const k = a.address.toLowerCase();
    if (skip.has(k)) continue;
    skip.add(k);
    out.push(a);
  }
  return out;
};

/**
 * Reply: the sender (or their Reply-To). Reply all: the sender plus everyone in To and Cc, without our own mailbox
 * address. Replying to our own sent message goes to its recipients again. Forward: nobody yet.
 */
export function replyRecipients(parent: ParentMessage, mode: ReplyMode, ourAddress: string): { to: Addr[]; cc: Addr[]; subject: string } {
  if (mode === "forward") return { to: [], cc: [], subject: forwardSubject(parent.subject) };
  const subject = replySubject(parent.subject);
  const mine = ourAddress.toLowerCase();
  const skip = new Set<string>([mine]);
  const sender: Addr = parent.replyTo ? { name: parent.fromName, address: parent.replyTo } : { name: parent.fromName, address: parent.fromAddress };
  const fromUs = parent.direction === "out" || parent.fromAddress.toLowerCase() === mine;
  const to = fromUs ? uniq(parent.to, skip) : uniq([sender], skip);
  if (mode === "reply") return { to, cc: [], subject };
  const others = uniq([...(fromUs ? [] : parent.to), ...parent.cc], skip).filter((a) => !(isOurAddress(a.address) && a.address.toLowerCase() === mine));
  return { to, cc: others, subject };
}

/** "Mon, 23 Nov 2026, 09:40" in Kigali time: the date in a quote or forward header. */
export const longDate = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Africa/Kigali", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export type QuoteSource = ParentMessage & { dateLong: string; text: string };

/**
 * The earlier message as the composer shows it behind ···: "On … wrote:" for a reply, the "Forwarded message" block
 * for a forward (the same words the server adds when sending, lib/mail/html.ts).
 */
export function quotePreview(m: QuoteSource, mode: ReplyMode): QuotePreview {
  const who = m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress;
  if (mode !== "forward") return { head: `On ${m.dateLong}, ${who} wrote:`, body: m.text };
  const to = m.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
  return { head: ["---------- Forwarded message ---------", `From: ${who}`, `Date: ${m.dateLong}`, `Subject: ${m.subject}`, ...(to ? [`To: ${to}`] : [])].join("\n"), body: m.text };
}

/** Reply, Reply all and Forward for one message, so the reply header can switch between them. */
export function replyOptions(m: QuoteSource, ourAddress: string): Record<ReplyMode, ReplyOption> {
  const one = (mode: ReplyMode): ReplyOption => {
    const r = replyRecipients(m, mode, ourAddress);
    return { to: r.to.map((a) => a.address), cc: r.cc.map((a) => a.address), subject: r.subject, quote: quotePreview(m, mode) };
  };
  return { reply: one("reply"), all: one("all"), forward: one("forward") };
}
