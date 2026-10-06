import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import ResetForm from "@/components/auth/reset-form";
import { Button } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage() {
  // Only reachable with the session created by the emailed recovery link.
  const user = await getCurrentUser();

  return (
    <AuthShell>
      {user ? (
        <>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">Choose a new password</h1>
            <p className="text-[15px] text-muted">Pick something you have not used before.</p>
          </div>
          <ResetForm />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">This link has expired</h1>
            <p className="text-[15px] text-muted">
              Reset links work once and expire after a short time. Request a new one to continue.
            </p>
          </div>
          <Button href="/forgot-password" className="w-full">
            Request a new link
          </Button>
        </>
      )}
    </AuthShell>
  );
}
