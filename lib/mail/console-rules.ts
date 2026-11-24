// The Mail console's small rules (docs/MAIL_CRM.md "Mail console", "Storage honesty"): storage allowances and what is
// used, address checks for new users and extra addresses, sender rules, and labels for forwarding. Pure: the console
// pages, its server actions and the tests share it.

import { cleanAddress, isOurAddress, MAIL_DOMAIN } from "./addresses";

/** The storage allowances an admin steps through with − and + (MB). */
export const QUOTAS = [50, 100, 250, 500, 1000] as const;
export const isQuota = (mb: number) => (QUOTAS as readonly number[]).includes(mb);

const MB = 1024 * 1024;
export const bytesToMb = (bytes: number) => bytes / MB;

/** "250 MB", "1 GB", "1.5 GB", "4.2 MB", "0 MB". */
export function formatMb(mb: number): string {
  if (mb >= 1000) {
    const gb = mb / 1000;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  if (mb > 0 && mb < 10) return `${mb.toFixed(1).replace(/\.0$/, "")} MB`;
  return `${Math.round(mb)} MB`;
}

/**
 * The next allowance up (+1) or down (−1) from the current one, or null when there is none or when going down would
 * leave less than what the person already uses. A current value outside the list snaps to the nearest step.
 */
export function stepQuota(current: number, dir: 1 | -1, usedMb = 0): number | null {
  const steps = QUOTAS as readonly number[];
  let i = steps.indexOf(current);
  if (i < 0) {
    // Not one of the steps: + goes to the first bigger one, − to the first smaller one.
    const next = dir > 0 ? steps.find((s) => s > current) : [...steps].reverse().find((s) => s < current);
    return next === undefined || (dir < 0 && next < usedMb) ? null : next;
  }
  i += dir;
  if (i < 0 || i >= steps.length) return null;
  const next = steps[i];
  return dir < 0 && next < usedMb ? null : next;
}

/** Bytes used per member: the sum of their own (personal) mailbox's messages. */
export function storageByMember(mailboxes: { id: string; memberId: string | null }[], sums: { mailboxId: string; bytes: number }[]): Record<string, number> {
  const byBox = new Map(sums.map((s) => [s.mailboxId, s.bytes]));
  const out: Record<string, number> = {};
  for (const b of mailboxes) if (b.memberId) out[b.memberId] = (out[b.memberId] ?? 0) + (byBox.get(b.id) ?? 0);
  return out;
}

export type StorageSummary = { givenMb: number; usedMb: number; poolMb: number; leftMb: number; over: boolean; usedPct: number; givenPct: number };

/** The pool card: what is given out, what is used, and what is still free to give. Percentages are of the pool. */
export function storageSummary(quotasMb: number[], usedBytes: number, poolMb: number): StorageSummary {
  const givenMb = quotasMb.reduce((a, b) => a + b, 0);
  const usedMb = bytesToMb(usedBytes);
  const pct = (v: number) => (poolMb > 0 ? Math.min(100, Math.round((v / poolMb) * 1000) / 10) : 0);
  return { givenMb, usedMb, poolMb, leftMb: Math.max(0, poolMb - givenMb), over: givenMb > poolMb, usedPct: pct(usedMb), givenPct: pct(givenMb) };
}

/** Percent of a person's allowance in use (0–100) and whether to warn (over 80%). */
export function quotaUse(usedBytes: number, quotaMb: number): { pct: number; warn: boolean } {
  const pct = quotaMb > 0 ? Math.min(100, Math.round((bytesToMb(usedBytes) / quotaMb) * 100)) : 0;
  return { pct, warn: pct > 80 };
}

/** A new address's part before the @: letters, numbers, dots, dashes, underscores; starts and ends with a letter or number. */
export const LOCAL_PART = /^[a-z0-9]([a-z0-9._-]{0,40}[a-z0-9])?$/;

/** "Grace", "grace@bupulse.com" or " GRACE " -> "grace@bupulse.com"; null when it is not one of our addresses. */
export function ourAddressFrom(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (!raw.includes("@")) return LOCAL_PART.test(raw) ? `${raw}@${MAIL_DOMAIN}` : null;
  const a = cleanAddress(raw);
  if (!a || !isOurAddress(a)) return null;
  return LOCAL_PART.test(a.slice(0, a.lastIndexOf("@"))) ? a : null;
}

export type Taken = { mailboxes: string[]; members: string[]; aliases: string[] };

/**
 * Why an address cannot be given (null when it is free). A named personal mailbox nobody owns yet (cyusa@ from the
 * first setup) is free for a new user, since createMailUser gives that mailbox to them.
 */
export function addressProblem(address: string, taken: Taken, opts: { unownedPersonal?: string[] } = {}): string | null {
  if (taken.members.includes(address)) return `${address} already has B Mail.`;
  if (taken.aliases.includes(address)) return `${address} is already an extra address.`;
  if (taken.mailboxes.includes(address) && !opts.unownedPersonal?.includes(address)) return `${address} is already taken.`;
  return null;
}

/** A sender rule pattern: a full address, or a domain as "@domain" ("example.com" and "@Example.com" are read too). */
export function senderPattern(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/^mailto:/, "");
  if (!raw) return null;
  if (raw.includes("@") && !raw.startsWith("@")) return cleanAddress(raw);
  const domain = raw.replace(/^@/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) && domain.length <= 253 ? `@${domain}` : null;
}

/** "cyusa@" for our addresses, the full address for outside ones; "(copy)" when the person keeps their own copy. */
export function forwardShort(target: string, keepCopy: boolean): string {
  const short = isOurAddress(target) ? `${target.slice(0, target.lastIndexOf("@"))}@` : target;
  return keepCopy ? `${short} (copy)` : short;
}

/** Where forwarded mail lands, for the rules list: 'Folder "Grace" + All inboxes · kept for Grace'. */
export function forwardWhere(f: { external: boolean; keepCopy: boolean }, sourceName: string): string {
  const kept = f.keepCopy ? `kept for ${sourceName}` : `Not kept for ${sourceName}`;
  return f.external ? `Outside address · ${kept}` : `Folder "${sourceName}" + All inboxes · ${kept}`;
}

/** Colours offered for a department (brand blue first). */
export const DEPT_COLORS = ["#1f5ae6", "#7b5cff", "#d4571c", "#0d5f61", "#5131c4", "#11633a", "#b4236b", "#8a4b00", "#3c3c43"] as const;
export const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/** A steady avatar colour for a person (the same address always gets the same colour). */
export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DEPT_COLORS[h % DEPT_COLORS.length];
}

export const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** "Sales, Support" style list of first names, at most `max`, then "and 3 more". */
export function firstNames(names: string[], max = 4): string {
  const first = names.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);
  if (first.length <= max) return first.join(", ");
  return `${first.slice(0, max).join(", ")} and ${first.length - max} more`;
}
