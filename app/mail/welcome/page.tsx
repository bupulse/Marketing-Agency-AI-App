import { WelcomeSteps } from "@/components/mail/welcome";
import { prisma } from "@/lib/db";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { formatPhone } from "@/lib/phone";
import { photoUrl } from "@/lib/mail/photo";
import { requireMail } from "@/lib/mail/session";

export const metadata = { title: "Welcome" };

// After the first sign-in (design "Welcome"): photo, signature, look. Skip is always there; it shows once.
export default async function MailWelcomePage() {
  const me = await requireMail();
  const [member, settings] = await Promise.all([
    me.memberId ? prisma.mailMember.findUnique({ where: { id: me.memberId }, select: { id: true, name: true, title: true, phone: true, photoPath: true } }) : null,
    prisma.mailSettings.findUnique({ where: { id: "default" } }),
  ]);
  const p = me.prefs;
  return (
    <WelcomeSteps
      profile={{
        name: member?.name ?? me.name,
        title: member?.title ?? "",
        phone: member?.phone ?? "",
        email: me.email,
        look: typeof p.signatureTemplate === "string" ? p.signatureTemplate : settings?.defaultTemplate ?? "classic",
        photo: member ? photoUrl(member.id, member.photoPath) : null,
        photoInSignature: p.photoInSignature !== false,
        background: typeof p.background === "string" ? p.background : "kigali-hills",
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
    />
  );
}
