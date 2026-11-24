// Department / Everyone as a recipient (docs/MAIL_CRM.md "Departments"): one personal email per person, each starting
// with "Hello {first_name}," and {first_name} filled in anywhere in the subject and the body. Owner and Mail admins may
// pick any department (and Everyone); a head only their own; members none (lib/mail/access-rules.ts
// sendableDepartmentIds). Pure: the composer's preview, the server's send and the tests share it.

import { escapeHtml } from "./html";

/** The token a department chip carries in the To list ("dept:dep_sales", "dept:everyone"). */
export const DEPT_PREFIX = "dept:";
export const EVERYONE = "everyone";
export const FIRST_NAME = "{first_name}";
/** At most this many personal emails in one send (the free plan sends 100 a day in all). */
export const PERSONAL_MAX = 100;

export const isDeptToken = (s: string) => s.startsWith(DEPT_PREFIX);
export const deptToken = (id: string) => `${DEPT_PREFIX}${id}`;

/** Splits the To list into typed addresses and department ids. */
export function splitTokens(list: string[]): { addresses: string[]; departments: string[] } {
  const addresses: string[] = [];
  const departments: string[] = [];
  for (const raw of list) {
    const s = raw.trim();
    if (!s) continue;
    if (isDeptToken(s)) {
      const id = s.slice(DEPT_PREFIX.length);
      if (id && !departments.includes(id)) departments.push(id);
    } else addresses.push(s);
  }
  return { addresses, departments };
}

export type Person = { name: string; address: string; firstName: string };
export type DepartmentGroup = { id: string; name: string; color: string; head: string | null; members: Person[] };

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

/** "Grace Uwimana" -> "Grace"; no name: "jean.bosco@x.rw" -> "Jean". */
export function firstNameOf(name: string | null | undefined, address: string): string {
  const clean = (name ?? "").replace(/["<>]/g, "").trim();
  if (clean && !clean.includes("@")) return clean.split(/\s+/)[0];
  const local = address.split("@")[0].split("+")[0];
  return cap(local.split(/[._-]+/).find(Boolean) ?? local);
}

const FIRST_NAME_RE = /\{\{?\s*first[_ ]?name\s*\}?\}/gi;

export const hasFirstName = (s: string) => new RegExp(FIRST_NAME_RE.source, "i").test(s);

/** Puts the person's first name wherever {first_name} is written. In HTML the name is escaped. */
export function fillFirstName(template: string, firstName: string, opts: { html?: boolean } = {}): string {
  const value = opts.html ? escapeHtml(firstName) : firstName;
  return template.replace(FIRST_NAME_RE, () => value);
}

/** The automatic first line of a department email. */
export const greetingFor = (firstName: string) => `Hello ${firstName},`;

/**
 * Why these departments may not be picked, or null. `allowed` is what this person may send to (Everyone appears there
 * only for the owner and Mail admins).
 */
export function departmentProblem(requested: string[], allowed: { id: string; name: string }[]): string | null {
  for (const id of requested) {
    if (!allowed.some((d) => d.id === id)) return id === EVERYONE ? "Only the owner and Mail admins may send to everyone." : "You may not send to that department.";
  }
  return null;
}

/**
 * Who gets a personal email: every member of the chosen departments plus every address typed in To, once each, without
 * the sender's own addresses. Typed addresses that belong to a team member use that member's name.
 */
export function personalRecipients(departmentIds: string[], typed: { name: string; address: string }[], groups: DepartmentGroup[], mine: string[]): Person[] {
  const skip = new Set(mine.map((a) => a.toLowerCase()));
  const known = new Map<string, Person>();
  for (const g of groups) for (const p of g.members) known.set(p.address.toLowerCase(), p);
  const out: Person[] = [];
  const add = (p: Person) => {
    const k = p.address.toLowerCase();
    if (skip.has(k)) return;
    skip.add(k);
    out.push(p);
  };
  for (const id of departmentIds) for (const p of groups.find((g) => g.id === id)?.members ?? []) add(p);
  for (const t of typed) add(known.get(t.address.toLowerCase()) ?? { name: t.name, address: t.address, firstName: firstNameOf(t.name, t.address) });
  return out;
}
