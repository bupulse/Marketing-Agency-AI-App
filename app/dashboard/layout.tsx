import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { BackgroundBlobs } from "@/components/motion";
import { AppShell, type ShellNotice } from "@/components/app/app-shell";
import { networkLabel } from "@/lib/content-board/labels";
import { missingApps } from "@/lib/content-board/queries";
import { getAppContext } from "@/components/app/context";
import { TrialBanner } from "@/components/app/trial-banner";
import { endingNotice, formatDate } from "@/components/billing/helpers";
import { manualGrace } from "@/lib/billing/period";
import { brandPalette, isHexColor } from "@/lib/color-contrast";
import { AutoTimezone } from "@/components/publishing/auto-timezone";
import { AnnouncementBanner } from "@/components/app/announcement-banner";
import { InstallPrompt, PhoneAppSetup } from "@/components/app/phone-app";
import { InvoiceLock } from "@/components/app/invoice-lock";
import { can } from "@/lib/team/roles";
import { getActiveAnnouncements } from "@/lib/admin/service";
import { OfferBanner } from "@/components/app/offer-banner";
import { clientOffer } from "@/lib/offers/service";
import { currentManualPayment } from "@/lib/billing/momo";
import { offerCheckingReference } from "@/lib/billing/momo-shared";
import { isServiceEnabled } from "@/lib/admin/switch";
import { unseenStudioVideos } from "@/lib/video-library/service";
import { unreadCount } from "@/lib/inbox/service";
import { dailyPostsWaiting } from "@/lib/daily-posts/service";
import { QuizBanner } from "@/components/knowledge/quiz-banner";
import { quizEntry } from "@/lib/knowledge/quiz-entry";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · BuPulse" },
  robots: { index: false, follow: false },
  // Lets a phone install the dashboard as an app (docs/guide/features/32-phone-app-and-whatsapp-share.md): on an iPhone
  // that is also what makes lead alerts (lib/push) possible.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "BuPulse", statusBarStyle: "default" },
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { business, role, displayName, firstName, email, businessName, usage, entitlements, isTrial, trialDaysLeft, logoUrl, brandColors, pendingDemo, pendingInvoice } =
    await getAppContext();

  // Not started yet with an invoice to pay instead of a trial (docs/INVOICES.md; without one getAppContext sent the
  // company to /start-trial): every dashboard route shows the invoice and nothing else (the server refuses the rest
  // anyway: lib/entitlements.ts grants no features and lib/usage.ts answers pending_demo while PENDING_DEMO).
  if (pendingDemo) {
    if (!pendingInvoice) redirect("/start-trial");
    return (
      <>
        <BackgroundBlobs />
        <PhoneAppSetup />
        <InvoiceLock invoice={pendingInvoice} businessId={business.id} role={role} firstName={firstName} email={email} businessName={businessName} />
      </>
    );
  }

  // A paid plan that ended (CANCELED, EXPIRED, or ACTIVE past its period and grace: lib/billing/period.ts): read-only,
  // like lib/usage.ts, which refuses generation as "inactive".
  const planEnded = !isTrial && entitlements.block === "inactive";
  const trialLabel = isTrial
    ? trialDaysLeft === 0
      ? "Trial ended"
      : `${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left`
    : planEnded
      ? "Ended"
      : null;

  const status = usage.subscription.status;
  // A Mobile Money (or custom) plan whose period ended still works for its grace days: say until when.
  const grace = !isTrial && !entitlements.block && status === "ACTIVE" ? manualGrace(usage.subscription) : null;
  // The lookups below are independent, so they run together (each database round trip is felt on every page: about
  // 240 ms from the test site's Mac). A failing lookup must never break the dashboard.
  const [announcements, offer, missing, dailyWaiting, newVideos, studioOn, inboxUnread] = await Promise.all([
    getActiveAnnouncements({ id: business.userId, plan: usage.subscription.plan }).catch(() => []),
    // A custom plan offer waiting for the owner (docs/OFFERS.md): only those who can pay see it.
    can(role, "billing") ? clientOffer(business.id).catch(() => null) : null,
    // Apps posts are made for that are not connected (docs/CONTENT.md): under the bell until they are.
    entitlements.usable.has("content") ? missingApps(business.id).catch(() => []) : [],
    // Daily posts made for you that still wait for approval today (docs/CONTENT.md "Daily posts").
    entitlements.usable.has("dailyPosts") && can(role, "content") ? dailyPostsWaiting(business.id, business.timezone || "UTC").catch(() => 0) : 0,
    // Studio videos that finished and were not opened in the Videos library yet (docs/VIDEO_STUDIO_SPLIT.md).
    unseenStudioVideos(business.id).catch(() => 0),
    // The Video Studio link in the sidebar: shown once the studio is switched on, to those who may make content.
    can(role, "content") ? isServiceEnabled("studio").catch(() => false) : false,
    // The badge on Inbox: one indexed count, only when the plan has the inbox.
    entitlements.inPlan.has("inbox") ? unreadCount(business.id).catch(() => 0) : 0,
  ]);
  // A Mobile Money payment of that offer reported and being checked: the banner says so instead of "Pay now".
  const offerPayment = offer?.status === "accepted" ? await currentManualPayment(business.userId).catch(() => null) : null;
  const notices: ShellNotice[] = missing.length
    ? [
        {
          id: "connect-apps",
          title: "Connect your apps so we can post for you",
          text: `${missing.map(networkLabel).join(", ")} ${missing.length === 1 ? "is" : "are"} not connected. Their posts come to you as reminders to post yourself.`,
          href: can(role, "channels") ? "/dashboard/connections" : "/dashboard/content",
          action: can(role, "channels") ? "Connect apps" : "See the posts",
        },
      ]
    : [];
  if (dailyWaiting > 0) {
    notices.unshift({
      id: "daily-posts",
      title: "Your posts for today are ready",
      text: `BuPulse made ${dailyWaiting === 1 ? "1 post" : `${dailyWaiting} posts`} for you today. Approve ${dailyWaiting === 1 ? "it" : "them"} to post.`,
      href: "/dashboard/content",
      action: "Approve them",
    });
  }
  if (newVideos > 0) {
    notices.push({
      id: "videos-ready",
      title: newVideos === 1 ? "Your video is ready" : `${newVideos} new videos are ready`,
      text: "The Video Studio finished it. Watch it, download it or schedule it on your channels.",
      href: "/dashboard/video",
      action: newVideos === 1 ? "View video" : "View videos",
    });
  }
  const studio = studioOn ? ((usage.limits.videoCredits ?? 0) > 0 ? "open" : "upgrade") : null;

  return (
    <>
      <BackgroundBlobs />
      <PhoneAppSetup />
      <AppShell
        brand={{ logoUrl, colors: brandPalette(brandColors), hasColors: brandColors.some(isHexColor) }}
        displayName={displayName}
        firstName={firstName}
        email={email}
        businessName={businessName}
        role={role}
        features={[...entitlements.inPlan]}
        notices={notices}
        studio={studio}
        inboxUnread={inboxUnread}
        plan={{
          name: usage.plan.name,
          trialLabel,
          used: usage.used.text,
          max: usage.limits.text,
        }}
      >
        <AnnouncementBanner items={announcements} />
        {offer && <OfferBanner offer={offer} checkingReference={offerCheckingReference(offerPayment, offer)} />}
        <TrialBanner
          isTrial={isTrial}
          trialDaysLeft={trialDaysLeft}
          subscriptionActive={status === "TRIALING" || status === "ACTIVE"}
          pastDue={status === "PAST_DUE"}
          text={{ used: usage.used.text, max: usage.limits.text }}
          image={{ used: usage.used.image, max: usage.limits.image }}
          canPay={can(role, "billing")}
          planEnded={planEnded}
          endsOn={endingNotice(usage.subscription)}
          grace={grace ? { ended: formatDate(grace.ended) ?? "", until: formatDate(grace.until) ?? "" } : null}
        />
        <Suspense fallback={null}>
          <QuizNudge business={business} role={role} usable={entitlements.usable} />
        </Suspense>
        <InstallPrompt />
        {children}
        {can(role, "settings") && <AutoTimezone current={business.timezone} />}
      </AppShell>
    </>
  );
}

/**
 * "Finish your Business info: a 5-minute quiz" on every page until Business info is complete (docs/QUIZ_MODE.md "On
 * every page"). Streamed, so the score's queries never hold up the page; a failing lookup shows nothing.
 */
async function QuizNudge({ business, role, usable }: { business: Parameters<typeof quizEntry>[0]; role: Parameters<typeof quizEntry>[1]; usable: Parameters<typeof quizEntry>[2] }) {
  const entry = await quizEntry(business, role, usable).catch(() => null);
  if (!entry || !entry.playable || entry.overall >= 100) return null;
  return <QuizBanner overall={entry.overall} href={entry.href} label={entry.label} nextRound={entry.nextRound} />;
}
