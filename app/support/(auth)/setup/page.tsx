import { redirect } from "next/navigation";
import { SupportAuthShell } from "@/components/support-app/auth-shell";
import { SetupAuthenticator } from "@/components/support-app/sign-in-forms";
import { hasRecentMailboxProof } from "@/lib/support/app-access";
import { requireAgentIdentity, supportUrl } from "@/lib/support/app-auth";
import { hasSetupGrant } from "@/lib/support/setup-grant";

export const metadata = { title: "Add your authenticator" };

export default async function SupportSetupPage() {
  const { agent, methods, hasVerifiedTotp, supabase } = await requireAgentIdentity();
  if (hasVerifiedTotp) redirect(await supportUrl("/verify"));
  // An account the admin made with a password may add its first authenticator without an emailed code (setup-grant.ts).
  const { data } = await supabase.auth.getUser();
  const granted = !!data.user && hasSetupGrant(data.user.app_metadata);
  return (
    <SupportAuthShell step="STEP 2 OF 2" title="Add your authenticator app" intro="The support app asks for a 6-digit code at every sign-in. Use Microsoft Authenticator, Google Authenticator or 1Password on your phone.">
      <SetupAuthenticator emailConfirmed={granted || hasRecentMailboxProof(methods)} email={agent.email} />
    </SupportAuthShell>
  );
}
