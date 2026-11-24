import { notFound } from "next/navigation";
import { DepartmentDetail } from "@/components/mail/console-department";
import { prisma } from "@/lib/db";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Department" };

// One department (owner 24 Nov 2026): rename it, recolour it, pick its head, and drag people in from the whole team.
export default async function MailConsoleDepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMailAdmin();
  const [dept, depts, members] = await Promise.all([
    prisma.mailDepartment.findUnique({ where: { id }, select: { id: true, name: true, color: true, headMemberId: true } }),
    prisma.mailDepartment.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.mailMember.findMany({ orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true, name: true, email: true, departmentId: true, role: true, status: true } }),
  ]);
  if (!dept) notFound();
  return (
    <DepartmentDetail
      key={dept.id}
      dept={dept}
      departments={depts}
      people={members.map((m) => ({ id: m.id, name: m.name || m.email.split("@")[0], email: m.email, departmentId: m.departmentId, locked: m.role === "owner" && !me.isSuper, suspended: m.status === "suspended" }))}
    />
  );
}
