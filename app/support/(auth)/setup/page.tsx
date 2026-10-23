import { redirect } from "next/navigation";
import { SupportAuthShell } from "@/components/support-app/auth-shell";
import { SetupAuthenticator } from "@/components/support-app/sign-in-forms";
import { hasRecentMailboxProof } from "@/lib/support/app-access";
import { requireAgentIdentity, supportUrl } from "@/lib/support/app-auth";

export const metadata = { title: "Add your authenticator" };

export default async function SupportSetupPage() {
  const { agent, methods, hasVerifiedTotp } = await requireAgentIdentity();
  if (hasVerifiedTotp) redirect(await supportUrl("/verify"));
  return (
    <SupportAuthShell step="STEP 2 OF 2" title="Add your authenticator app" intro="The support app asks for a 6-digit code at every sign-in. Use Microsoft Authenticator, Google Authenticator or 1Password on your phone.">
      <SetupAuthenticator emailConfirmed={hasRecentMailboxProof(methods)} email={agent.email} />
    </SupportAuthShell>
  );
}
