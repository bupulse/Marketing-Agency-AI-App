import { redirect } from "next/navigation";
import { SupportAuthShell } from "@/components/support-app/auth-shell";
import { SupportCodeForm } from "@/components/support-app/code-form";
import { requireAgentIdentity, supportUrl } from "@/lib/support/app-auth";
import { verifyAgentCode } from "../actions";

export const metadata = { title: "Enter your code" };

export default async function SupportVerifyPage() {
  const { aal, hasVerifiedTotp } = await requireAgentIdentity();
  if (aal?.currentLevel === "aal2" && hasVerifiedTotp) redirect(await supportUrl("/"));
  if (!hasVerifiedTotp) redirect(await supportUrl("/setup"));
  return (
    <SupportAuthShell step="STEP 2 OF 2" title="Enter your 6-digit code" intro="Open your authenticator app and type the code for BuPulse Support.">
      <SupportCodeForm action={verifyAgentCode} label="Sign in" />
      <p className="text-center text-[13px] text-muted">Lost your phone? Ask your supervisor to reset your code.</p>
    </SupportAuthShell>
  );
}
