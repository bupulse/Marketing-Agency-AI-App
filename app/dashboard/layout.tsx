import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { AppShell } from "@/components/app/app-shell";
import { getAppContext } from "@/components/app/context";
import { PLANS } from "@/lib/plans";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · BuPulse" },
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { displayName, firstName, email, businessName, usage, isTrial, trialDaysLeft } = await getAppContext();

  const trialLabel = isTrial
    ? trialDaysLeft === 0
      ? "Trial ended"
      : `${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left`
    : null;

  return (
    <>
      <BackgroundBlobs />
      <AppShell
        displayName={displayName}
        firstName={firstName}
        email={email}
        businessName={businessName}
        plan={{
          name: PLANS[usage.subscription.plan].name,
          trialLabel,
          used: usage.used.text,
          max: usage.limits.text,
        }}
      >
        {children}
      </AppShell>
    </>
  );
}
