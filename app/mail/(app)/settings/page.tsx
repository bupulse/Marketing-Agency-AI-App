import { SettingsForm } from "@/components/mail/settings-form";
import { prisma } from "@/lib/db";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { formatPhone } from "@/lib/phone";
import { photoUrl } from "@/lib/mail/photo";
import { requireMail } from "@/lib/mail/session";

export const metadata = { title: "Settings" };

export default async function MailSettingsPage() {
  const me = await requireMail();
  const [member, settings, forwards] = await Promise.all([
    me.memberId ? prisma.mailMember.findUnique({ where: { id: me.memberId }, select: { id: true, name: true, title: true, phone: true, photoPath: true } }) : null,
    prisma.mailSettings.findUnique({ where: { id: "default" } }),
    prisma.mailForwarder.findMany({ where: { target: me.email, enabled: true }, select: { source: true }, orderBy: { source: "asc" } }),
  ]);
  const p = me.prefs;
  return (
    <SettingsForm
      profile={{
        name: member?.name ?? me.name,
        title: member?.title ?? "",
        phone: member?.phone ?? "",
        extra: typeof p.signatureExtra === "string" ? p.signatureExtra : "",
        background: typeof p.background === "string" ? p.background : "kigali-hills",
        email: me.email,
        look: typeof p.signatureTemplate === "string" ? p.signatureTemplate : settings?.defaultTemplate ?? "classic",
        photo: member ? photoUrl(member.id, member.photoPath) : null,
        photoInSignature: p.photoInSignature !== false,
      }}
      company={{
        website: settings?.website ?? "bupulse.com",
        address: settings?.address ?? "Kigali, Rwanda",
        companyPhone: settings?.companyPhone ? formatPhone(settings.companyPhone) : null,
        linkedinUrl: settings?.linkedinUrl ?? null,
        instagramUrl: settings?.instagramUrl ?? null,
        facebookUrl: settings?.facebookUrl ?? null,
        ctaText: settings?.ctaText ?? "Get your free BuPulse quote",
        ctaUrl: settings?.ctaUrl ?? "https://bupulse.com/quote",
        logoUrl: `${publicSiteUrl()}/brand/logo.png`,
      }}
      forwards={forwards.map((f) => f.source)}
      hasBackgroundPhoto={typeof p.backgroundPhoto === "string"}
    />
  );
}
