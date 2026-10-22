import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import ForgotForm from "@/components/auth/forgot-form";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

const NOTICES: Record<string, string> = {
  expired: "This reset link has expired or was already used. Enter your email to get a new code and link.",
  "other-browser": "That reset link was opened in another browser. Enter your email to get a new code, and type it here.",
};

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { error } = await searchParams;
  const notice = typeof error === "string" ? NOTICES[error] : undefined;
  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Forgot your password?</h1>
        <p className="text-[15px] text-muted">Enter your email and we will send you a code and a link to choose a new one.</p>
      </div>
      <ForgotForm notice={notice} />
    </AuthShell>
  );
}
