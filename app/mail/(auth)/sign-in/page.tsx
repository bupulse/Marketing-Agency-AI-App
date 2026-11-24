import { MailAuthShell, MailSignIn } from "@/components/mail/auth";
import { signInMailWithCode, signInMailWithPassword } from "../actions";

export const metadata = { title: "Sign in" };

export default async function MailSignInPage({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const { with: how } = await searchParams;
  return (
    <MailAuthShell title="Sign in to B Mail" intro="Your BuPulse address and the 6-digit code from your authenticator app.">
      <MailSignIn codeAction={signInMailWithCode} passwordAction={signInMailWithPassword} initial={how === "password" ? "password" : "code"} />
    </MailAuthShell>
  );
}
