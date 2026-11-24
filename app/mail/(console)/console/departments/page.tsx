import { DepartmentsView } from "@/components/mail/console-departments";
import { prisma } from "@/lib/db";
import { DAILY_LIMIT } from "@/lib/mail/send";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Departments" };

export default async function MailConsoleDepartmentsPage() {
  await requireMailAdmin();
  const [depts, members] = await Promise.all([
    prisma.mailDepartment.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, headMemberId: true } }),
    prisma.mailMember.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, departmentId: true } }),
  ]);
  return (
    <DepartmentsView
      depts={depts.map((d) => ({ ...d, members: members.filter((m) => m.departmentId === d.id).map((m) => ({ id: m.id, name: m.name ?? m.email, email: m.email })) }))}
      dailyLimit={DAILY_LIMIT}
    />
  );
}
