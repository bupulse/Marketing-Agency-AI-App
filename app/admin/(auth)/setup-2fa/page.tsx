import { redirect } from "next/navigation";
import { AdminAuthShell as AuthShell } from "@/components/admin/auth-shell";
import { hasRecentEmailProof, requireAdminIdentity } from "@/lib/admin/auth";
import { SetupTwoFactor } from "./setup";

export const metadata = { title: "Set up authenticator" };

export default async function SetupPage() {
  const { supabase, email } = await requireAdminIdentity();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect("/admin");
  if (aal?.nextLevel === "aal2") redirect("/admin/verify");

  return (
    <AuthShell>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Set up your authenticator</h1>
        <p className="text-[15px] text-muted">
          The admin console always asks for a 6-digit code. Works with Microsoft Authenticator, Google Authenticator or 1Password.
        </p>
      </div>
      <SetupTwoFactor emailConfirmed={hasRecentEmailProof(aal?.currentAuthenticationMethods)} email={email} />
    </AuthShell>
  );
}
