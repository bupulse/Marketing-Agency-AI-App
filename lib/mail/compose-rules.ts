// Who a reply goes to, and the subject, for Reply / Reply all / Forward (docs/MAIL_CRM.md "Reading and replying").
// Pure: the composer and the tests share it.

import { isOurAddress, type Addr } from "./addresses";
import { forwardSubject, replySubject } from "./threading";

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
