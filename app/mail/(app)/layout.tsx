import { after } from "next/server";
import { Suspense } from "react";
import { MailShell, type ShellData } from "@/components/mail/shell";
import { prisma } from "@/lib/db";
import { resolveBackground } from "@/lib/mail/backgrounds";
import { mailboxesFor, navExtras } from "@/lib/mail/queries";
import { signedUrl } from "@/lib/mail/storage";
import { photoUrl } from "@/lib/mail/photo";
import { deliverDue, sendsLeftToday, signatureFor } from "@/lib/mail/send";
import { requireMail } from "@/lib/mail/session";

// Every B Mail page: the signed-in person at AAL2 (lib/mail/session.ts), their mailboxes and the shared frame.
export default async function MailAppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMail();
  const [mailboxes, sendsLeft, extras, settings, member, labels] = await Promise.all([
    mailboxesFor(me),
    sendsLeftToday(),
    navExtras(me),
    prisma.mailSettings.findUnique({ where: { id: "default" }, select: { glassClarity: true, glassTint: true, usersChangeGlass: true } }),
    me.memberId ? prisma.mailMember.findUnique({ where: { id: me.memberId }, select: { quotaMb: true, photoPath: true } }) : null,
    prisma.mailLabel.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
  ]);
  const choice = typeof me.prefs.background === "string" ? me.prefs.background : "kigali-hills";
  // Own photo background: a short-lived link to the private file; anything else is a scene or a gradient.
  // Signed whenever they have one, so picking "Your photo" paints at once (it is only shown when chosen).
  const ownPhoto = typeof me.prefs.backgroundPhoto === "string" ? await signedUrl(me.prefs.backgroundPhoto) : null;
  const photo = choice === "photo" ? ownPhoto : null;
  const photoDark = me.prefs.backgroundPhotoDark !== false;
  const bg = resolveBackground(choice, me.email);
  const canChangeGlass = settings?.usersChangeGlass !== false || me.isAdmin;
  const glass = canChangeGlass && typeof me.prefs.glass === "number" ? me.prefs.glass : settings?.glassClarity ?? 60;
  const sendFrom = mailboxes.filter((m) => m.address).map((m) => ({ id: m.id, label: m.kind === "personal" && m.address === me.email ? me.name : m.name, address: m.address! }));
  const own = mailboxes.find((m) => m.kind === "personal" && m.address === me.email) ?? mailboxes.find((m) => m.address);
  const signature = await signatureFor(me, own?.address ?? me.email);
  // Anything whose undo window ended while nobody was watching goes out now.
  after(() => deliverDue().catch(() => undefined));
  const data: ShellData = {
    me: { name: me.name, email: me.email, isAdmin: me.isAdmin, initial: (me.name[0] ?? "?").toUpperCase(), role: me.isSuper ? "Super admin" : me.isAdmin ? "Mail admin" : "Member", photo: me.memberId ? photoUrl(me.memberId, member?.photoPath) : null },
    mailboxes: mailboxes.map((m) => ({ id: m.id, name: m.name, address: m.address, kind: m.kind, visibility: m.visibility, unread: m.unread, color: m.color })),
    sendFrom: own ? [sendFrom.find((s) => s.id === own.id)!, ...sendFrom.filter((s) => s.id !== own.id)] : sendFrom,
    signatureHtml: signature.html,
    sendsLeft,
    background: choice,
    backgroundCss: photo ? `url(${JSON.stringify(photo)}) center / cover no-repeat` : bg.css,
    backgroundName: photo ? "Your photo" : bg.name,
    backgroundDark: photo ? photoDark : !!bg.dark,
    backgroundCredit: photo ? null : bg.credit ?? null,
    hasPhoto: typeof me.prefs.backgroundPhoto === "string",
    photoBackgroundCss: ownPhoto ? `url(${JSON.stringify(ownPhoto)}) center / cover no-repeat` : null,
    photoBackgroundDark: photoDark,
    glass,
    glassTint: settings?.glassTint ?? "light",
    canChangeGlass,
    forwarded: extras.forwarded,
    drafts: extras.drafts,
    labels,
    storage: { usedMb: Math.round((extras.usedBytes / 1_048_576) * 10) / 10, quotaMb: member?.quotaMb ?? 1000 },
  };
  return (
    <Suspense>
      <MailShell data={data}>{children}</MailShell>
    </Suspense>
  );
}
