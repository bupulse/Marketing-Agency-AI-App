// Address suggestions in To / Cc / Bcc while typing: departments the person may send to, team members and shared
// mailboxes, and recent contacts from the mailboxes they see. Pure: the composer and the tests share it.

import type { DepartmentGroup } from "./personal";

export type BookPerson = { name: string; address: string; kind: "team" | "mailbox" | "recent"; note?: string };
export type AddressBook = { people: BookPerson[]; departments: DepartmentGroup[] };

const KIND_RANK: Record<BookPerson["kind"], number> = { team: 0, mailbox: 1, recent: 2 };

/** 0 = the name or address starts with the words typed, 1 = a word in the name does, 2 = somewhere inside, -1 = no. */
function score(q: string, name: string, address: string): number {
  const n = name.toLowerCase();
  const a = address.toLowerCase();
  if (n.startsWith(q) || a.startsWith(q)) return 0;
  if (n.split(/\s+/).some((w) => w.startsWith(q)) || a.split("@")[0].split(/[._+-]/).some((w) => w.startsWith(q))) return 1;
  if (q.length >= 3 && (n.includes(q) || a.includes(q))) return 2;
  return -1;
}

/**
 * Suggestions for what was typed: departments first (when allowed in this field), then people. Already-chosen
 * addresses and departments are left out; a person known from the team and from recent mail shows once, as the team
 * member.
 */
export function suggest(query: string, book: AddressBook, chosen: string[], opts: { departments: boolean; limit?: number } = { departments: true }): { departments: DepartmentGroup[]; people: BookPerson[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { departments: [], people: [] };
  const taken = new Set(chosen.map((c) => c.toLowerCase()));
  const departments = opts.departments
    ? book.departments
        .map((d) => ({ d, s: score(q, `${d.name} department`, d.id) }))
        .filter((x) => x.s >= 0 && !taken.has(`dept:${x.d.id}`.toLowerCase()))
        .sort((x, y) => x.s - y.s)
        .slice(0, 4)
        .map((x) => x.d)
    : [];
  const best = new Map<string, { p: BookPerson; s: number }>();
  for (const p of book.people) {
    const k = p.address.toLowerCase();
    if (taken.has(k)) continue;
    const s = score(q, p.name, p.address);
    if (s < 0) continue;
    const prev = best.get(k);
    if (!prev || KIND_RANK[p.kind] < KIND_RANK[prev.p.kind] || (KIND_RANK[p.kind] === KIND_RANK[prev.p.kind] && s < prev.s)) best.set(k, { p, s: Math.min(s, prev?.s ?? s) });
  }
  const people = [...best.values()]
    .sort((x, y) => x.s - y.s || KIND_RANK[x.p.kind] - KIND_RANK[y.p.kind] || x.p.name.localeCompare(y.p.name))
    .slice(0, opts.limit ?? 6)
    .map((x) => x.p);
  return { departments, people };
}
