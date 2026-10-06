import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import SignupForm from "@/components/auth/signup-form";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user?.email_confirmed_at) redirect("/dashboard");

  return (
    <AuthShell wide>
      <SignupForm />
    </AuthShell>
  );
}
