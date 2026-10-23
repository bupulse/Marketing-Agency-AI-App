import { SupportAuthShell, noteClass } from "@/components/support-app/auth-shell";
import { SignInForm } from "@/components/support-app/sign-in-forms";

export const metadata = { title: "Sign in" };

const NOTES: Record<string, string> = {
  no_access: "That account is not a support agent. Sign in with the work email your supervisor invited.",
  locked: "Your account is locked. Ask your supervisor to unlock it.",
  signed_out: "You are signed out.",
};

export default async function SupportSignInPage({ searchParams }: PageProps<"/support/sign-in">) {
  const { error } = await searchParams;
  const note = typeof error === "string" ? NOTES[error] : undefined;
  return (
    <SupportAuthShell step="STEP 1 OF 2" title="Sign in">
      {note && <p role="status" className={noteClass}>{note}</p>}
      <SignInForm />
    </SupportAuthShell>
  );
}
