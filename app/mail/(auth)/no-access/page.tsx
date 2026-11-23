import { MailAuthShell } from "@/components/mail/auth";

export const metadata = { title: "No access" };

export default function MailNoAccessPage() {
  return (
    <MailAuthShell title="B Mail is not on for this account" intro="Ask your mail admin to add you in the Mail console. If you just got an invite, open the link in that email first.">
      <a href="/apps" className="inline-flex h-12 items-center justify-center rounded-full border border-black/15 font-semibold text-graphite hover:bg-black/5">Back to my BuPulse services</a>
    </MailAuthShell>
  );
}
