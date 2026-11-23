// Raw MIME (what Cloudflare Email Routing hands the Worker) into the parts Mail stores. postal-mime does the MIME work
// (multipart, encodings, charsets, attachments); this file cleans the result. No server-only imports: tests use it.

import PostalMime from "postal-mime";
import type { Address as PostalAddress } from "postal-mime";
import { cleanAddress, type Addr } from "./addresses";
import { cleanMessageId, messageIdList } from "./threading";

/** A message bigger than this is refused by the inbound route (Cloudflare Email Routing stops at 25 MiB too). */
export const MAX_RAW_BYTES = 26 * 1024 * 1024;
/** Stored HTML is cut at this length (the raw message keeps everything). */
export const MAX_HTML_CHARS = 1_500_000;
export const MAX_TEXT_CHARS = 300_000;

export type ParsedAttachment = { filename: string; contentType: string; content: Uint8Array; contentId: string | null; inline: boolean };

export type ParsedMail = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: Addr;
  replyTo: string | null;
  to: Addr[];
  cc: Addr[];
  subject: string;
  date: Date;
  text: string;
  html: string | null;
  snippet: string;
  attachments: ParsedAttachment[];
  authResults: string | null;
  /** The receiving side said the sender failed DMARC, or the message carries a spam flag. */
  suspicious: boolean;
};

function flatten(list: PostalAddress[] | undefined): Addr[] {
  const out: Addr[] = [];
  for (const a of list ?? []) {
    const members = a.group ? a.group : [a];
    for (const m of members) {
      const address = cleanAddress(m.address);
      if (address && !out.some((o) => o.address === address)) out.push({ name: (m.name ?? "").trim().slice(0, 200), address });
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML into readable plain text (for the snippet, search and a text fallback). Not a sanitizer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first words of a message for the list: quoted replies ("On ... wrote:", "> ") left out. */
export function makeSnippet(text: string, max = 160): string {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (/^on .{4,200} wrote:$/i.test(l) || /^-{2,}\s*(original message|forwarded message)/i.test(l) || /^from:\s/i.test(l) && lines.length) break;
    if (l.startsWith(">")) continue;
    if (l) lines.push(l);
    if (lines.join(" ").length > max) break;
  }
  const s = lines.join(" ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** spf/dkim/dmarc results from the Authentication-Results headers ("spf=pass dkim=pass dmarc=fail"). */
export function authSummary(values: string[]): string | null {
  const found: Record<string, string> = {};
  for (const v of values) {
    for (const m of v.matchAll(/\b(spf|dkim|dmarc)=([a-z]+)/gi)) {
      const k = m[1].toLowerCase();
      // The first verdict per method wins: the receiving server's own header is the topmost.
      if (!found[k]) found[k] = m[2].toLowerCase();
    }
  }
  const parts = ["spf", "dkim", "dmarc"].filter((k) => found[k]).map((k) => `${k}=${found[k]}`);
  return parts.length ? parts.join(" ") : null;
}

function safeFilename(name: string | null, contentType: string, i: number): string {
  const clean = (name ?? "").replace(/[\x00-\x1f\x7f/\\]/g, "_").trim().slice(0, 180);
  if (clean) return clean;
  const ext = contentType.split("/")[1]?.split(/[;+]/)[0]?.replace(/[^a-z0-9]/gi, "") || "bin";
  return `attachment-${i + 1}.${ext}`;
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

export async function parseMime(raw: ArrayBuffer | Uint8Array | string, receivedAt = new Date()): Promise<ParsedMail> {
  const mail = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer", maxNestingDepth: 50 });
  const header = (key: string) => mail.headers.filter((h) => h.key === key).map((h) => h.value);
  const from = flatten(mail.from ? [mail.from] : undefined)[0] ?? flatten(mail.sender ? [mail.sender] : undefined)[0] ?? { name: "", address: "unknown@invalid" };
  const html = mail.html ? mail.html.slice(0, MAX_HTML_CHARS) : null;
  const text = (mail.text?.trim() ? mail.text : html ? htmlToText(html) : "").slice(0, MAX_TEXT_CHARS);
  const parsedDate = mail.date ? new Date(mail.date) : null;
  // A date in the future (wrong clock) or unreadable is the time we received it.
  const date = parsedDate && Number.isFinite(parsedDate.getTime()) && parsedDate.getTime() <= receivedAt.getTime() + 5 * 60_000 ? parsedDate : receivedAt;
  const authResults = authSummary(header("authentication-results"));
  const spamFlag = header("x-spam-flag").some((v) => /yes/i.test(v)) || header("x-spam-status").some((v) => /^yes/i.test(v));
  return {
    messageId: cleanMessageId(mail.messageId),
    inReplyTo: cleanMessageId(mail.inReplyTo),
    references: messageIdList(mail.references),
    from,
    replyTo: flatten(mail.replyTo)[0]?.address ?? null,
    to: flatten(mail.to),
    cc: flatten(mail.cc),
    subject: (mail.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 500),
    date,
    text,
    html,
    snippet: makeSnippet(text),
    attachments: mail.attachments.map((a, i) => {
      const contentType = (a.mimeType || "application/octet-stream").toLowerCase().slice(0, 120);
      return {
        filename: safeFilename(a.filename, contentType, i),
        contentType,
        content: toBytes(a.content),
        contentId: a.contentId ? a.contentId.replace(/^<|>$/g, "").slice(0, 300) : null,
        inline: a.disposition === "inline" && !!a.contentId,
      };
    }),
    authResults,
    suspicious: spamFlag || /dmarc=fail/.test(authResults ?? ""),
  };
}
