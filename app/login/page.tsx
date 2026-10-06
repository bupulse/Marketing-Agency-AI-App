import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResendByEmail } from "@/components/auth/resend-by-email";
import { safeNext } from "@/lib/auth/safe-next";
import { getCurrentUser } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const user = await getCurrentUser();
  if (user?.email_confirmed_at) redirect(next);

  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Sign in to BuPulse</h1>
        <p className="text-[15px] text-muted">Welcome back. Pick up where you left off.</p>
      </div>
      {params.error === "confirm" ? (
        <ResendByEmail />
      ) : params.error ? (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          Sign-in failed. Please try again.
        </p>
      ) : null}
      <LoginForm next={next} />
    </AuthShell>
  );
}
