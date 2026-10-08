import { redirect } from "next/navigation";
import { AdminAuthShell as AuthShell } from "@/components/admin/auth-shell";
import { requireAdminIdentity } from "@/lib/admin/auth";
import { verifyCode } from "../actions";
import { CodeForm } from "../code-form";

export const metadata = { title: "Verify" };

export default async function VerifyPage() {
  const { supabase } = await requireAdminIdentity();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect("/admin");
  if (aal?.nextLevel !== "aal2") redirect("/admin/setup-2fa");

  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Admin sign-in</h1>
        <p className="text-[15px] text-muted">Open your authenticator app and enter the 6-digit code for BuPulse admin.</p>
      </div>
      <CodeForm action={verifyCode} label="Verify" />
    </AuthShell>
  );
}
