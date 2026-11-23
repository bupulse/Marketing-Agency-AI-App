import { redirect } from "next/navigation";
import { CodeForm, MailAuthShell } from "@/components/mail/auth";
import { requireMailIdentity } from "@/lib/mail/session";
import { verifyMailCode } from "../actions";

export const metadata = { title: "Enter your code" };

export default async function MailVerifyPage() {
  const { aal, hasTotp } = await requireMailIdentity();
  if (!hasTotp) redirect("/mail/setup");
  if (aal?.currentLevel === "aal2") redirect("/mail");
  return (
    <MailAuthShell title="Enter your 6-digit code" intro="Open your authenticator app and type the code for BuPulse.">
      <CodeForm action={verifyMailCode} label="Open B Mail" />
    </MailAuthShell>
  );
}
