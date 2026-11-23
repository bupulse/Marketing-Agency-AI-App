// Which conversation a message belongs to. Pure: the inbound route and sending both use it.
//
// 1. Headers first: a message whose In-Reply-To or References names a message we already have joins that thread.
// 2. Else the same subject (without Re:/Fwd:) with a shared outside participant within THREAD_WINDOW_DAYS joins it
//    (some senders and phones drop the headers). A blank subject never joins by subject.
// 3. Else a new thread.

export const THREAD_WINDOW_DAYS = 30;

const PREFIX = /^\s*((re|fw|fwd|aw|wg|tr|rv|sv|vs|antw|odp|ynt)(\[\d+\])?\s*:\s*)+/i;

/** "Re: Fwd: RE:  Invoice 12 " -> "invoice 12". Bracket tags like "[BuPulse]" stay. */
export function subjectKey(subject: string | null | undefined): string {
  let s = (subject ?? "").replace(/\s+/g, " ").trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(PREFIX, "").trim();
  }
  return s.toLowerCase().slice(0, 300);
}

/** A Message-ID header value without angle brackets and spaces, or null. */
export function cleanMessageId(value: string | null | undefined): string | null {
  const m = /<?\s*([^<>\s]+@[^<>\s]+)\s*>?/.exec(value ?? "");
  return m ? m[1].slice(0, 500) : null;
}

/** Every message id in a References / In-Reply-To header, in order, without duplicates. */
export function messageIdList(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (value ?? "").matchAll(/<([^<>\s]+@[^<>\s]+)>/g)) if (!out.includes(m[1])) out.push(m[1].slice(0, 500));
  if (!out.length) {
    const one = cleanMessageId(value);
    if (one) out.push(one);
  }
  return out;
}

export type ThreadCandidate = {
  id: string;
  subjectKey: string;
  lastMessageAt: Date;
  /** Outside addresses seen in the thread. */
  participants: string[];
};

export type ThreadingInput = {
  /** Thread ids of our stored messages whose Message-ID is in this message's In-Reply-To / References. */
  headerMatches: string[];
  subjectKey: string;
  date: Date;
  /** Outside addresses on this message (from, to, cc minus our own). */
  participants: string[];
  /** Recent threads in the mailbox with the same subjectKey. */
  candidates: ThreadCandidate[];
};

/** The thread to file the message in, or null for a new one. */
export function pickThread(input: ThreadingInput): string | null {
  if (input.headerMatches.length) return input.headerMatches[0];
  if (!input.subjectKey) return null;
  const windowMs = THREAD_WINDOW_DAYS * 86_400_000;
  const people = new Set(input.participants.map((p) => p.toLowerCase()));
  const match = input.candidates
    .filter((c) => c.subjectKey === input.subjectKey && Math.abs(input.date.getTime() - c.lastMessageAt.getTime()) <= windowMs)
    .filter((c) => c.participants.some((p) => people.has(p.toLowerCase())))
    .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())[0];
  return match?.id ?? null;
}

/** The References header for a reply: the parent's References plus the parent's own id (last 20 kept). */
export function replyReferences(parent: { messageId: string | null; references: string[] }): string[] {
  const refs = [...parent.references];
  if (parent.messageId && !refs.includes(parent.messageId)) refs.push(parent.messageId);
  return refs.slice(-20);
}

/** "Re: <subject>" unless it already starts with Re:. */
export const replySubject = (subject: string) => (/^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`.trim());
/** "Fwd: <subject>" unless it already starts with Fwd:/Fw:. */
export const forwardSubject = (subject: string) => (/^\s*fwd?\s*:/i.test(subject) ? subject : `Fwd: ${subject}`.trim());
