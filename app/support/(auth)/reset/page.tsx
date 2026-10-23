import { SupportAuthShell } from "@/components/support-app/auth-shell";
import { PasswordFlow } from "@/components/support-app/sign-in-forms";
import { linkStep, param } from "../link-step";

export const metadata = { title: "New password" };

/** The "Forgot password" email's link. */
export default async function SupportResetPage({ searchParams }: PageProps<"/support/reset">) {
  const sp = await searchParams;
  return (
    <SupportAuthShell title="Choose a new password">
      <PasswordFlow tokenHash={param(sp.token_hash)} type="recovery" initial={await linkStep()} cta="Continue" />
    </SupportAuthShell>
  );
}
