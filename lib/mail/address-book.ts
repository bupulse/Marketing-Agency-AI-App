import "server-only";
import { prisma } from "@/lib/db";
import type { Addr } from "./addresses";
import { EVERYONE, firstNameOf, type DepartmentGroup, type Person } from "./personal";
import type { AddressBook, BookPerson } from "./suggest";
import type { MailMe } from "./session";

// Who the composer can suggest (docs/mail-crm/GAPS.md C2, C4): team members with their mailbox address, shared
// mailboxes, the departments this person may send to (me.departmentIds, plus Everyone for the owner and Mail admins),
// and recent contacts from the mailboxes they see.

type TeamRow = { id: string; name: string; address: string; departmentId: string | null; title: string | null };

async function team(): Promise<TeamRow[]> {
  const members = await prisma.mailMember.findMany({
    where: { mail: true, status: { in: ["active", "invited"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, departmentId: true, title: true },
  });
  const boxes = await prisma.mailbox.findMany({ where: { memberId: { in: members.map((m) => m.id) } }, select: { memberId: true, address: true } });
  const own = new Map(boxes.map((b) => [b.memberId, b.address]));
  return members.map((m) => {
    const address = (own.get(m.id) ?? m.email).toLowerCase();
    return { id: m.id, name: m.name?.trim() || firstNameOf(null, address), address, departmentId: m.departmentId, title: m.title };
  });
}

const person = (t: TeamRow): Person => ({ name: t.name, address: t.address, firstName: firstNameOf(t.name, t.address) });

/**
 * The departments this person may send to, each with the people who get a personal email (the sender left out).
 * Everyone (every team member) is there for the owner and Mail admins only.
 */
export async function sendableDepartments(me: MailMe, rows?: TeamRow[]): Promise<DepartmentGroup[]> {
  if (!me.departmentIds.length && !me.isAdmin) return [];
  const [people, departments] = await Promise.all([rows ?? team(), prisma.mailDepartment.findMany({ where: { id: { in: me.departmentIds } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })]);
  const mine = me.email.toLowerCase();
  const others = people.filter((p) => p.address !== mine);
  const out: DepartmentGroup[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
    color: d.color,
    head: people.find((p) => p.id === d.headMemberId)?.name ?? null,
    members: others.filter((p) => p.departmentId === d.id).map(person),
  }));
  if (me.isAdmin) out.push({ id: EVERYONE, name: "Everyone", color: "#1d1d1f", head: null, members: others.map(person) });
  return out;
}

const SKIP = /(^|[._-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)([._+-]|@)/i;

/** Recent outside contacts: who wrote to the mailboxes this person sees, and who they wrote to. */
async function recent(me: MailMe, ours: Set<string>): Promise<BookPerson[]> {
  if (!me.mailboxIds.length) return [];
  const [inbound, outbound] = await Promise.all([
    prisma.mailMessage.findMany({ where: { mailboxId: { in: me.mailboxIds }, direction: "in" }, orderBy: { date: "desc" }, take: 400, select: { fromAddress: true, fromName: true } }),
    prisma.mailMessage.findMany({ where: { mailboxId: { in: me.mailboxIds }, direction: "out", status: { in: ["sent", "queued", "sending"] } }, orderBy: { date: "desc" }, take: 200, select: { to: true, cc: true } }),
  ]);
  const seen = new Map<string, BookPerson>();
  const add = (name: string, address: string) => {
    const a = address.trim().toLowerCase();
    if (!a.includes("@") || ours.has(a) || SKIP.test(a) || seen.has(a)) return;
    seen.set(a, { name: name.trim() || a.split("@")[0], address: a, kind: "recent", note: "Recent" });
  };
  for (const m of outbound) for (const a of [...((m.to as Addr[] | null) ?? []), ...((m.cc as Addr[] | null) ?? [])]) add(a.name ?? "", a.address ?? "");
  for (const m of inbound) add(m.fromName, m.fromAddress);
  return [...seen.values()].slice(0, 300);
}

export async function addressBook(me: MailMe): Promise<AddressBook> {
  const [rows, shared] = await Promise.all([team(), prisma.mailbox.findMany({ where: { kind: "shared", address: { not: null } }, orderBy: { name: "asc" }, select: { address: true, name: true } })]);
  const depNames = new Map((await prisma.mailDepartment.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  const people: BookPerson[] = [
    ...rows.filter((r) => r.address !== me.email.toLowerCase()).map((r): BookPerson => ({ name: r.name, address: r.address, kind: "team", note: [r.title, r.departmentId ? depNames.get(r.departmentId) : null].filter(Boolean).join(" · ") || "Team" })),
    ...shared.map((s): BookPerson => ({ name: s.name, address: s.address!, kind: "mailbox", note: "Shared mailbox" })),
  ];
  const ours = new Set(people.map((p) => p.address));
  ours.add(me.email.toLowerCase());
  const [departments, recents] = await Promise.all([sendableDepartments(me, rows), recent(me, ours)]);
  return { people: [...people, ...recents], departments };
}
