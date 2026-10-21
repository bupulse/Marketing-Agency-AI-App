import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GlassCard } from "@/components/ui";
import { CreatorsFrame } from "@/components/creators/marketplace/header";
import { CreatorSignUpForm } from "@/components/creators/marketplace/signup-form";
import { publicViewer } from "@/lib/creators/auth";
import { turnstileSiteKey } from "@/lib/widget/turnstile";

export const metadata: Metadata = {
  title: "Make your creator account",
  description: "A free BuPulse creator account: apply to companies' campaigns in one tap and get paid for your views.",
  robots: { index: false, follow: true },
};

// A creator's own sign-up (docs/CREATOR_MARKETPLACE.md, "Creator accounts"). Signed-in creators go to their portal; a
// signed-in company person is told to sign out first (one login is a company or a creator, not both, from here).
export default async function CreatorSignUpPage() {
  const viewer = await publicViewer();
  if (viewer.kind === "creator") redirect("/creator");

  return (
    <CreatorsFrame viewer={viewer.kind}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pb-16 pt-8">
        <GlassCard strong padding="lg" className="flex flex-col gap-6 p-6 sm:p-8">
          {viewer.kind === "company" ? (
            <div role="status" className="flex flex-col gap-3">
              <h1 className="text-2xl font-semibold tracking-[-0.03em]">You are signed in as a company</h1>
              <p className="text-[15px] text-muted">Creators apply with a creator account. Sign out, then make one with another email.</p>
              <form action="/auth/signout" method="post">
                <button type="submit" className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline">Sign out</button>
              </form>
            </div>
          ) : (
            <CreatorSignUpForm turnstileSiteKey={turnstileSiteKey()} />
          )}
        </GlassCard>
      </main>
    </CreatorsFrame>
  );
}
