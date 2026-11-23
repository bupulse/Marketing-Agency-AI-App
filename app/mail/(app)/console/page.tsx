import { ConsoleView } from "@/components/mail/console";
import { prisma } from "@/lib/db";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Mail console" };

export default async function MailConsolePage() {
  await requireMailAdmin();
  const [depts, members, forwarders, settings, boxes] = await Promise.all([
    prisma.mailDepartment.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, headMemberId: true } }),
    prisma.mailMember.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, departmentId: true, quotaMb: true, status: true } }),
    prisma.mailForwarder.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.mailSettings.findUnique({ where: { id: "default" } }),
    prisma.mailbox.findMany({ where: { address: { not: null } }, select: { address: true } }),
  ]);
  return (
    <ConsoleView
      depts={depts}
      members={members.map((m) => ({ ...m, name: m.name ?? m.email }))}
      forwarders={forwarders.map((f) => ({ id: f.id, source: f.source, target: f.target, external: f.external, keepCopy: f.keepCopy, enabled: f.enabled, verified: !!f.verifiedAt }))}
      company={{ companyPhone: settings?.companyPhone ?? "", website: settings?.website ?? "bupulse.com", address: settings?.address ?? "Kigali, Rwanda", linkedinUrl: settings?.linkedinUrl ?? "", instagramUrl: settings?.instagramUrl ?? "", facebookUrl: settings?.facebookUrl ?? "", ctaText: settings?.ctaText ?? "Get your free BuPulse quote", ctaUrl: settings?.ctaUrl ?? "https://bupulse.com/quote" }}
      mailboxAddresses={boxes.map((b) => b.address!).filter(Boolean)}
    />
  );
}
