import { ForwardingView } from "@/components/mail/console-forwarding";
import { prisma } from "@/lib/db";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Forwarding" };

export default async function MailConsoleForwardingPage() {
  await requireMailAdmin();
  const [forwarders, aliases, boxes, members, depts] = await Promise.all([
    prisma.mailForwarder.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.mailAlias.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, address: true, mailboxId: true } }),
    prisma.mailbox.findMany({ where: { address: { not: null } }, orderBy: [{ sortOrder: "asc" }, { address: "asc" }], select: { id: true, address: true, name: true, kind: true, memberId: true } }),
    prisma.mailMember.findMany({ select: { id: true, name: true, email: true, status: true, departmentId: true } }),
    prisma.mailDepartment.findMany({ select: { id: true, name: true } }),
  ]);
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  // Who an address belongs to, for the notes under each rule ("Grace Uwimana · Support", "Shared mailbox").
  const owners: Record<string, { name: string; note: string }> = {};
  for (const b of boxes) {
    const m = b.memberId ? members.find((x) => x.id === b.memberId) : null;
    const name = m?.name ?? b.name;
    owners[b.address!] = m
      ? { name: name.split(" ")[0], note: m.status === "suspended" ? "Suspended user" : [name, m.departmentId ? deptName.get(m.departmentId) : null].filter(Boolean).join(" · ") }
      : { name: b.name, note: b.kind === "catchall" ? "Other addresses" : "Shared mailbox" };
  }
  const boxAddress = new Map(boxes.map((b) => [b.id, b.address!]));
  return (
    <ForwardingView
      rules={forwarders.map((f) => ({ id: f.id, source: f.source, target: f.target, external: f.external, keepCopy: f.keepCopy, enabled: f.enabled, verified: !!f.verifiedAt }))}
      aliases={aliases.map((a) => ({ id: a.id, address: a.address, into: boxAddress.get(a.mailboxId) ?? "a removed mailbox" }))}
      mailboxes={boxes.map((b) => ({ id: b.id, address: b.address! }))}
      owners={owners}
    />
  );
}
