import type { Metadata } from "next";
import Link from "next/link";
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
  const email = typeof params.email === "string" ? params.email.slice(0, 254) : undefined;

  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Sign in to BuPulse</h1>
        <p className="text-[15px] text-muted">Welcome back. Pick up where you left off.</p>
      </div>
      {(params.notice === "exists" || params.notice === "exists-google") && (
        <p role="status" className="rounded-2xl bg-ok-bg px-4 py-3 text-sm font-medium text-ok">
          You already have a BuPulse account{email ? ` with ${email}` : ""}.{" "}
          {params.notice === "exists-google" ? "It was created with Google, so use Continue with Google." : "Sign in below."}
        </p>
      )}
      {params.notice === "deletion-scheduled" && (
        <p role="status" className="rounded-2xl bg-ok-bg px-4 py-3 text-sm font-medium text-ok">
          Your account is scheduled for deletion in 30 days. Sign in any time before then to keep it.
        </p>
      )}
      {params.error === "confirm" ? (
        <ResendByEmail />
      ) : params.error === "use_password" ? (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {email ? `${email} uses` : "This account uses"} an email and password, so Google sign-in can’t be used
          for it. Please sign in the normal way with your password below, or choose “Forgot password?”.
        </p>
      ) : params.error ? (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          Sign-in failed. Please try again.
        </p>
      ) : null}
      <LoginForm next={next} defaultEmail={email} />
      <p className="text-center text-sm text-muted">
        A content creator?{" "}
        <Link href="/creators/signup" className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline">
          Make a creator account
        </Link>
      </p>
    </AuthShell>
  );
}
