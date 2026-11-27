import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell, waitlistFacts } from "@/components/auth/auth-shell";
import SignupForm from "@/components/auth/signup-form";
import { WaitlistSignup } from "@/components/auth/waitlist-signup";
import { getCurrentUser } from "@/lib/supabase/server";
import { cleanReturn } from "@/lib/auth/return-path";
import { industryOptions } from "@/lib/industries/server";
import { turnstileSiteKey } from "@/lib/widget/turnstile";
import { getWaitlist } from "@/lib/waitlist-server";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; waitlist?: string | string[] }> }) {
  const params = await searchParams;
  const next = cleanReturn(typeof params.next === "string" ? params.next : null);
  const user = await getCurrentUser();
  if (user?.email_confirmed_at) redirect(next);
  // Before launch (the waiting list is on, lib/waitlist.ts) no new accounts: the page takes a waiting-list request.
  const waitlist = await getWaitlist();
  if (waitlist) {
    return (
      <AuthShell wide facts={waitlistFacts(waitlist.dateLabel)}>
        <WaitlistSignup info={waitlist} refused={params.waitlist === "google"} />
      </AuthShell>
    );
  }
  const industries = await industryOptions();

  return (
    <AuthShell wide>
      <SignupForm next={next} industries={industries} turnstileSiteKey={turnstileSiteKey()} />
    </AuthShell>
  );
}
