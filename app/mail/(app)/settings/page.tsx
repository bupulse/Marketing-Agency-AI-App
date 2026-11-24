import { PasswordCard, SettingsForm } from "@/components/mail/settings-form";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { signatureFor } from "@/lib/mail/send";
import { requireMail } from "@/lib/mail/session";

export const metadata = { title: "Profile and signature" };

export default async function MailSettingsPage() {
  const me = await requireMail();
  const [member, settings, own] = await Promise.all([
    me.memberId ? prisma.mailMember.findUnique({ where: { id: me.memberId }, select: { name: true, title: true, phone: true } }) : null,
    prisma.mailSettings.findUnique({ where: { id: "default" }, select: { companyPhone: true } }),
    prisma.mailbox.findFirst({ where: { id: { in: me.mailboxIds }, kind: "personal", address: me.email }, select: { address: true } }),
  ]);
  const sig = await signatureFor(me, own?.address ?? me.email);
  return (
    <div className="flex flex-col gap-4">
    <SettingsForm
      profile={{ name: member?.name ?? me.name, title: member?.title ?? "", phone: member?.phone ?? "", extra: typeof me.prefs.signatureExtra === "string" ? me.prefs.signatureExtra : "", background: typeof me.prefs.background === "string" ? me.prefs.background : "kigali-hills", email: me.email }}
      signatureHtml={sig.html}
      companyPhone={settings?.companyPhone ? formatPhone(settings.companyPhone) : ""}
    />
    <PasswordCard />
    </div>
  );
}
