import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import SignupForm from "@/components/auth/signup-form";
import { getCurrentUser } from "@/lib/supabase/server";
import { cleanReturn } from "@/lib/auth/return-path";
import { industryOptions } from "@/lib/industries/server";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  const next = cleanReturn(typeof params.next === "string" ? params.next : null);
  const user = await getCurrentUser();
  if (user?.email_confirmed_at) redirect(next);
  const industries = await industryOptions();

  return (
    <AuthShell wide>
      <SignupForm next={next} industries={industries} />
    </AuthShell>
  );
}
