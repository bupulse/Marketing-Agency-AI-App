import { SupportAuthShell } from "@/components/support-app/auth-shell";
import { PasswordFlow } from "@/components/support-app/sign-in-forms";
import { linkStep, param } from "../link-step";

export const metadata = { title: "Welcome" };

/** The invite email's link: choose a password, then add the authenticator app. */
export default async function SupportAcceptPage({ searchParams }: PageProps<"/support/accept">) {
  const sp = await searchParams;
  return (
    <SupportAuthShell step="WELCOME" title="Join BuPulse Support" intro="Choose your password, then add an authenticator app on your phone. It takes two minutes.">
      <PasswordFlow tokenHash={param(sp.token_hash)} type={param(sp.type) || "invite"} initial={await linkStep()} cta="Choose my password" />
    </SupportAuthShell>
  );
}
