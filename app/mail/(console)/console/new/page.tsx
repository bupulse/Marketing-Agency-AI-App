import { NewUserView } from "@/components/mail/console-new-user";
import { prisma } from "@/lib/db";
import { companyForPreview } from "@/lib/mail/console-data";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Create a user" };

export default async function MailConsoleNewUserPage() {
  const me = await requireMailAdmin();
  const [depts, members, shared, settings, company] = await Promise.all([
    prisma.mailDepartment.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, headMemberId: true } }),
    prisma.mailMember.findMany({ select: { id: true, name: true, email: true, quotaMb: true } }),
    prisma.mailbox.findMany({ where: { kind: { not: "personal" }, address: { not: null } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, address: true, visibility: true, departmentId: true } }),
    prisma.mailSettings.findUnique({ where: { id: "default" }, select: { poolMb: true, defaultTemplate: true } }),
    companyForPreview(),
  ]);
  const names = new Map(members.map((m) => [m.id, m.name ?? m.email]));
  const given = members.reduce((a, m) => a + m.quotaMb, 0);
  return (
    <NewUserView
      depts={depts.map((d) => ({ id: d.id, name: d.name, color: d.color, headName: d.headMemberId ? names.get(d.headMemberId) ?? null : null }))}
      shared={shared.map((b) => ({ id: b.id, name: b.name, address: b.address!, everyone: b.visibility === "everyone", departmentId: b.visibility === "department" ? b.departmentId : null }))}
      poolLeftMb={Math.max(0, (settings?.poolMb ?? 1000) - given)}
      company={company}
      look={settings?.defaultTemplate ?? "classic"}
      isSuper={me.isSuper}
    />
  );
}
