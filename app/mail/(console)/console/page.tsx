import { UsersView } from "@/components/mail/console";
import { prisma } from "@/lib/db";
import { forwardShort, storageSummary } from "@/lib/mail/console-rules";
import { loadStorage } from "@/lib/mail/console-data";
import { DAILY_LIMIT, today } from "@/lib/mail/send";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Mail console" };

export default async function MailConsoleUsersPage() {
  const me = await requireMailAdmin();
  const [depts, members, forwarders, settings, storage, sendDay] = await Promise.all([
    prisma.mailDepartment.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, headMemberId: true } }),
    prisma.mailMember.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, departmentId: true, quotaMb: true, status: true } }),
    prisma.mailForwarder.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" }, select: { source: true, target: true, keepCopy: true } }),
    prisma.mailSettings.findUnique({ where: { id: "default" }, select: { poolMb: true } }),
    loadStorage(),
    prisma.mailSendDay.findUnique({ where: { day: today() } }),
  ]);
  const heads = new Set(depts.map((d) => d.headMemberId).filter(Boolean));
  const summary = storageSummary(members.map((m) => m.quotaMb), storage.totalBytes, settings?.poolMb ?? 1000);
  return (
    <UsersView
      depts={depts}
      members={members.map((m) => ({
        ...m,
        name: m.name ?? m.email,
        isHead: heads.has(m.id),
        usedBytes: storage.byMember[m.id] ?? 0,
        forwards: forwarders.filter((f) => f.source === m.email).map((f) => forwardShort(f.target, f.keepCopy)).join(", "),
      }))}
      summary={summary}
      admins={members.filter((m) => m.role !== "member").length}
      sentToday={sendDay?.sent ?? 0}
      dailyLimit={DAILY_LIMIT}
      isSuper={me.isSuper}
      myEmail={me.email}
    />
  );
}
