import { MailAuthShell, MailSignInForm } from "@/components/mail/auth";
import { signInMailWithCode } from "../actions";

export const metadata = { title: "Sign in" };

export default function MailSignInPage() {
  return (
    <MailAuthShell title="Sign in to B Mail" intro="Your BuPulse address and the 6-digit code from your authenticator app.">
      <MailSignInForm action={signInMailWithCode} />
      <a href="/login?next=%2Fmail" className="text-center text-[14px] font-semibold text-[#1f5ae6]">Sign in with your password instead</a>
    </MailAuthShell>
  );
}
