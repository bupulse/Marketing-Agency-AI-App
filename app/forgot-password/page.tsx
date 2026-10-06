import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import ForgotForm from "@/components/auth/forgot-form";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Forgot your password?</h1>
        <p className="text-[15px] text-muted">Enter your email and we will send you a link to choose a new one.</p>
      </div>
      <ForgotForm />
    </AuthShell>
  );
}
