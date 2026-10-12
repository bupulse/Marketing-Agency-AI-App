import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BackgroundBlobs } from "@/components/motion";
import { AppShell } from "@/components/app/app-shell";
import { getAppContext } from "@/components/app/context";
import { TrialBanner } from "@/components/app/trial-banner";
import { brandPalette, isHexColor } from "@/lib/color-contrast";
import { AutoTimezone } from "@/components/publishing/auto-timezone";
import { AnnouncementBanner } from "@/components/app/announcement-banner";
import { DemoLock } from "@/components/app/demo-lock";
import { InvoiceLock } from "@/components/app/invoice-lock";
import { openInvoiceOf } from "@/lib/invoices/service";
import { can } from "@/lib/team/roles";
import { getActiveAnnouncements } from "@/lib/admin/service";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · BuPulse" },
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { business, role, displayName, firstName, email, businessName, usage, entitlements, isTrial, trialDaysLeft, logoUrl, brandColors, pendingDemo } =
    await getAppContext();

  // Waiting for the demo: every dashboard route shows the demo and nothing else (the server refuses the rest anyway:
  // lib/entitlements.ts grants no features and lib/usage.ts answers pending_demo while the status is PENDING_DEMO).
  if (pendingDemo) {
    // After the demo the admin may skip the trial and send an invoice: then the invoice and how to pay it replace the
    // demo screen until it is paid (docs/INVOICES.md). A failed lookup falls back to the demo screen.
    const invoice = await openInvoiceOf(business.id).catch(() => null);
    return (
      <>
        <BackgroundBlobs />
        {invoice ? (
          <InvoiceLock invoice={invoice} businessId={business.id} role={role} firstName={firstName} email={email} businessName={businessName} />
        ) : (
          <DemoLock businessId={business.id} role={role} firstName={firstName} email={email} businessName={businessName} />
        )}
      </>
    );
  }

  const trialLabel = isTrial
    ? trialDaysLeft === 0
      ? "Trial ended"
      : `${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left`
    : null;

  const status = usage.subscription.status;
  // A failing lookup must never break the dashboard.
  const announcements = await getActiveAnnouncements({ id: business.userId, plan: usage.subscription.plan }).catch(() => []);

  return (
    <>
      <BackgroundBlobs />
      <AppShell
        brand={{ logoUrl, colors: brandPalette(brandColors), hasColors: brandColors.some(isHexColor) }}
        displayName={displayName}
        firstName={firstName}
        email={email}
        businessName={businessName}
        role={role}
        features={[...entitlements.inPlan]}
        plan={{
          name: usage.plan.name,
          trialLabel,
          used: usage.used.text,
          max: usage.limits.text,
        }}
      >
        <AnnouncementBanner items={announcements} />
        <TrialBanner
          isTrial={isTrial}
          trialDaysLeft={trialDaysLeft}
          subscriptionActive={status === "TRIALING" || status === "ACTIVE"}
          pastDue={status === "PAST_DUE"}
          text={{ used: usage.used.text, max: usage.limits.text }}
          image={{ used: usage.used.image, max: usage.limits.image }}
        />
        {children}
        {can(role, "settings") && <AutoTimezone current={business.timezone} />}
      </AppShell>
    </>
  );
}
