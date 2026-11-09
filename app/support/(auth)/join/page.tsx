import { SupportAuthShell } from "@/components/support-app/auth-shell";
import { JoinForm } from "@/components/support-app/join-form";
import { turnstileSiteKey } from "@/lib/widget/turnstile";

export const metadata = { title: "Ask to join" };

/** Would-be agents ask to join; admin@bupulse.com approves (docs/SUPPORT_DASHBOARD.md). */
export default function SupportJoinPage() {
  return (
    <SupportAuthShell step="SUPPORT TEAM" title="Ask to join">
      <JoinForm turnstileSiteKey={turnstileSiteKey()} />
    </SupportAuthShell>
  );
}
