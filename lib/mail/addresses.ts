// Email addresses for BuPulse Mail: clean them, tell ours from everyone else's, and pick the mailbox a message to one
// of our addresses belongs in (docs/MAIL_CRM.md decision 2). Pure: the inbound route, sending and the tests share it.

export type Addr = { name: string; address: string };

/** Our mail domain. Every address at it reaches Mail (named mailboxes, else the catch-all). */
export const MAIL_DOMAIN = "bupulse.com";

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** A lower-case address, or null when it is not one ("Name <a@b.c>" is read too). */
export function cleanAddress(value: string | null | undefined): string | null {
  let raw = (value ?? "").trim();
  const angle = /<([^<>]+)>\s*$/.exec(raw);
  if (angle) raw = angle[1].trim();
  raw = raw.replace(/^mailto:/i, "").toLowerCase();
  return ADDRESS.test(raw) && raw.length <= 254 ? raw : null;
}

export const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);

/** True for an address at our domain (any subdomain is someone else's). */
export const isOurAddress = (address: string, domain = MAIL_DOMAIN) => domainOf(address.toLowerCase()) === domain;

/** "sales+quote@bupulse.com" -> "sales@bupulse.com": plus-addressing lands in the base mailbox. */
export function baseAddress(address: string): string {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at).split("+")[0];
  return `${local}${address.slice(at)}`.toLowerCase();
}

export type MailboxRef = { id: string; address: string | null; kind: string };

/**
 * The mailbox for one envelope recipient: the named mailbox with that address (plus-addressing ignored), else the
 * catch-all for any other address at our domain, else null (not ours: refused).
 */
export function routeRecipient(recipient: string, mailboxes: MailboxRef[], domain = MAIL_DOMAIN): MailboxRef | null {
  const address = cleanAddress(recipient);
  if (!address || !isOurAddress(address, domain)) return null;
  const base = baseAddress(address);
  const named = mailboxes.find((m) => m.address && (m.address === address || m.address === base));
  if (named) return named;
  return mailboxes.find((m) => m.kind === "catchall") ?? null;
}

/** A list of addresses typed by a person ("a@b.c, Ana <ana@x.rw>; c@d.e") as clean entries; bad ones in `invalid`. */
export function parseAddressList(input: string): { list: Addr[]; invalid: string[] } {
  const list: Addr[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of splitAddressList(input)) {
    const address = cleanAddress(part);
    if (!address) {
      invalid.push(part);
      continue;
    }
    if (seen.has(address)) continue;
    seen.add(address);
    const name = part.includes("<") ? part.slice(0, part.lastIndexOf("<")).trim().replace(/^"|"$/g, "") : "";
    list.push({ name, address });
  }
  return { list, invalid };
}

/** Splits on commas and semicolons outside quotes. */
function splitAddressList(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    if ((ch === "," || ch === ";") && !quoted) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** "Ana Uwase <ana@x.rw>" for a header, the address alone when there is no name. Quotes a name with specials. */
export function formatAddress(a: Addr): string {
  const name = a.name.replace(/[\r\n"]/g, "").trim();
  if (!name) return a.address;
  return /[(),.:;<>@[\]\\]/.test(name) ? `"${name}" <${a.address}>` : `${name} <${a.address}>`;
}

/** The name to show: the display name, else the part before the @. */
export const displayName = (a: Addr) => a.name.trim() || a.address.split("@")[0];
