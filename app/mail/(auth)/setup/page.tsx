import { redirect } from "next/navigation";
import { MailAuthShell, SetupFlow } from "@/components/mail/auth";
import { requireMailIdentity } from "@/lib/mail/session";
import { confirmMailEnrollment, confirmMailProof, sendMailProof, startMailEnrollment } from "../actions";

export const metadata = { title: "Add your authenticator" };

export default async function MailSetupPage() {
  const { hasTotp } = await requireMailIdentity();
  if (hasTotp) redirect("/mail/verify");
  return (
    <MailAuthShell title="Add your authenticator app" intro="B Mail holds bank and company mail, so it asks for a 6-digit code from Google Authenticator, Microsoft Authenticator or 1Password at every sign-in.">
      <SetupFlow start={startMailEnrollment} confirm={confirmMailEnrollment} sendProof={sendMailProof} confirmProof={confirmMailProof} />
    </MailAuthShell>
  );
}
