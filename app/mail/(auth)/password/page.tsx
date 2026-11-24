import { redirect } from "next/navigation";
import { MailAuthShell, NewPasswordForm } from "@/components/mail/auth";
import { requireMailIdentity } from "@/lib/mail/session";
import { setMailPassword } from "../actions";

export const metadata = { title: "Choose your password" };

export default async function MailPasswordPage() {
  const { tempPassword, hasTotp, aal, email } = await requireMailIdentity();
  if (!tempPassword) redirect("/mail");
  if (hasTotp && aal?.currentLevel !== "aal2") redirect("/mail/verify");
  return (
    <MailAuthShell
      title="Choose your own password"
      intro={<>Welcome to B Mail, <b className="text-graphite">{email}</b>. The password you were given works once: choose your own now.{!hasTotp && " Next you add your authenticator app."}</>}
    >
      <ol aria-label="Steps" className="flex items-center gap-2 text-[12.5px] font-semibold text-slate">
        <li className="rounded-full bg-[#1f5ae6] px-2.5 py-1 text-white">1 Password</li>
        <li aria-hidden>›</li>
        <li className="rounded-full bg-black/[0.06] px-2.5 py-1">2 Authenticator</li>
        <li aria-hidden>›</li>
        <li className="rounded-full bg-black/[0.06] px-2.5 py-1">3 Your inbox</li>
      </ol>
      <NewPasswordForm action={setMailPassword} label="Save and continue" />
    </MailAuthShell>
  );
}
