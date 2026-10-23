import { SupportAuthShell } from "@/components/support-app/auth-shell";
import { ForgotForm } from "@/components/support-app/sign-in-forms";

export const metadata = { title: "Forgot password" };

export default function SupportForgotPage() {
  return (
    <SupportAuthShell title="Forgot your password?" intro="Enter your work email. We send a link to choose a new one; you still need your authenticator code to sign in.">
      <ForgotForm />
    </SupportAuthShell>
  );
}
