import { SupportAuthShell, noteClass } from "@/components/support-app/auth-shell";
import { AuthenticatorSignInForm, CodeSignInForm, SignInForm } from "@/components/support-app/sign-in-forms";
import { adminEmailCodeOn } from "@/lib/admin/auth";
import { loadServiceKeys } from "@/lib/admin/service-keys";

export const metadata = { title: "Sign in" };

const NOTES: Record<string, string> = {
  no_access: "That account is not a support agent. Sign in with the work email your supervisor invited.",
  locked: "Your account is locked. Ask your supervisor to unlock it.",
  signed_out: "You are signed out.",
};

export default async function SupportSignInPage({ searchParams }: PageProps<"/support/sign-in">) {
  const { error, with: method } = await searchParams;
  const note = typeof error === "string" ? NOTES[error] : undefined;
  // While the emailed code is off (ADMIN_LOGIN_EMAIL_CODE), "?with=code" is the email + authenticator code form.
  await loadServiceKeys();
  const emailCode = adminEmailCodeOn();
  const withCode = method === "code";
  return (
    <SupportAuthShell step={withCode && !emailCode ? "SIGN IN" : "STEP 1 OF 2"} title="Sign in">
      {note && <p role="status" className={noteClass}>{note}</p>}
      {withCode ? emailCode ? <CodeSignInForm /> : <AuthenticatorSignInForm /> : <SignInForm emailCode={emailCode} />}
    </SupportAuthShell>
  );
}
