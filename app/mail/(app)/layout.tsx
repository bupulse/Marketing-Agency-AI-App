import { after } from "next/server";
import { Suspense } from "react";
import { MailShell, type ShellData } from "@/components/mail/shell";
import { mailboxesFor } from "@/lib/mail/queries";
import { deliverDue, sendsLeftToday, signatureFor } from "@/lib/mail/send";
import { requireMail } from "@/lib/mail/session";

// Every B Mail page: the signed-in person at AAL2 (lib/mail/session.ts), their mailboxes and the shared frame.
export default async function MailAppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMail();
  const [mailboxes, sendsLeft] = await Promise.all([mailboxesFor(me), sendsLeftToday()]);
  const sendFrom = mailboxes.filter((m) => m.address).map((m) => ({ id: m.id, label: m.kind === "personal" && m.address === me.email ? me.name : m.name, address: m.address! }));
  const own = mailboxes.find((m) => m.kind === "personal" && m.address === me.email) ?? mailboxes.find((m) => m.address);
  const signature = await signatureFor(me, own?.address ?? me.email);
  // Anything whose undo window ended while nobody was watching goes out now.
  after(() => deliverDue().catch(() => undefined));
  const data: ShellData = {
    me: { name: me.name, email: me.email, isAdmin: me.isAdmin, initial: (me.name[0] ?? "?").toUpperCase() },
    mailboxes: mailboxes.map((m) => ({ id: m.id, name: m.name, address: m.address, kind: m.kind, visibility: m.visibility, unread: m.unread, color: m.color })),
    sendFrom: own ? [sendFrom.find((s) => s.id === own.id)!, ...sendFrom.filter((s) => s.id !== own.id)] : sendFrom,
    signatureHtml: signature.html,
    sendsLeft,
    background: typeof me.prefs.background === "string" ? me.prefs.background : "kigali-hills",
  };
  return (
    <Suspense>
      <MailShell data={data}>{children}</MailShell>
    </Suspense>
  );
}
