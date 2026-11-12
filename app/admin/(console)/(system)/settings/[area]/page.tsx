import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin/auth";
import { listAvailability } from "@/lib/admin/availability";
import { param } from "@/lib/admin/format";
import { getSettings } from "@/lib/admin/settings";
import { previewCostSummary } from "@/lib/preview/first-post";
import { dailyPostsToday } from "@/lib/daily-posts/service";
import { dailyTodayLine } from "@/lib/daily-posts/budget";
import { effectiveUsdToEur } from "@/lib/money/display-server";
import { publicSiteUrl, siteUrl } from "@/lib/auth/site-url";
import { cardUsdCents } from "@/lib/region-format";
import { DEMO_TIME_ZONE, WEEKDAY_NAMES } from "@/lib/demo/slots";
import { googleCalendarStatus } from "@/lib/google-calendar/calendar";
import { telegramStatus } from "@/lib/lead-alerts/telegram-settings";
import { approvedVoices } from "@/lib/content-languages/service";
import { APPROVAL_LANGUAGES } from "@/lib/content-languages/voice";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { getVatSettings } from "@/lib/billing/vat-server";
import { momoConfigured, mtnMomoPayDial } from "@/lib/billing/momo-shared";
import { PADDLE_WEBHOOK_PATH, paddleStatus } from "@/lib/billing/paddle-setup";
import { isSettingsSlug, SETTINGS_TITLE } from "@/components/admin/system/settings-areas";
import { CurrencyArea, GoalArea, MomoArea, PaddleArea, VatArea } from "@/components/admin/system/settings/money-areas";
import { ContentArea, VoicesArea } from "@/components/admin/system/settings/content-areas";
import { AvailabilityArea, CallsArea, GoogleCalendarArea, LeadAlertsArea } from "@/components/admin/system/settings/calls-areas";
import { LoadingArea, TrialArea } from "@/components/admin/system/settings/site-areas";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/admin/settings/[area]">) {
  const { area } = await params;
  return { title: isSettingsSlug(area) ? SETTINGS_TITLE[area] : "Settings" };
}

const TZ = DEMO_TIME_ZONE.replace("_", " ");

/**
 * One settings area of Admin -> Settings (the hub: ../page.tsx). Same permission as the old one-page Settings; each
 * area loads only what it shows. The forms post to the same server actions as before (./../actions.ts), which come
 * back here with ?notice= or ?error=.
 */
export default async function SettingsAreaPage({ params, searchParams }: PageProps<"/admin/settings/[area]">) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const [{ area }, sp] = await Promise.all([params, searchParams]);
  if (!isSettingsSlug(area)) notFound();
  const msg = { ok: param(sp.notice), bad: param(sp.error) };

  switch (area) {
    case "momo": {
      const momo = await getMomoSettings();
      return <MomoArea {...msg} momo={momo} dial={mtnMomoPayDial(momo.merchantCode)} ready={momoConfigured(momo)} />;
    }
    case "paddle":
      return <PaddleArea {...msg} paddle={await paddleStatus()} webhookUrl={`${publicSiteUrl()}${PADDLE_WEBHOOK_PATH}`} />;
    case "vat":
      return <VatArea {...msg} vat={await getVatSettings()} />;
    case "currency": {
      const s = await getSettings();
      return <CurrencyArea {...msg} s={s} exampleCents={cardUsdCents(15000, "RWF", s.usdToRwf, s.cardMarginPercent)} eur={await effectiveUsdToEur(s)} />;
    }
    case "goal": {
      const s = await getSettings();
      return <GoalArea {...msg} revenueGoalRwf={s.revenueGoalRwf} goalStartMonth={s.goalStartMonth} />;
    }
    case "content": {
      const [s, daily, previewCost] = await Promise.all([getSettings(), dailyPostsToday(), previewCostSummary()]);
      return <ContentArea {...msg} dailyPosts={s.dailyPosts} dailyLine={dailyTodayLine(daily)} skitVideos={s.skitVideos} firstPostPreview={s.firstPostPreview} previewCost={previewCost} />;
    }
    case "voices":
      return <VoicesArea {...msg} languages={APPROVAL_LANGUAGES} voices={await approvedVoices()} />;
    case "lead-alerts":
      return <LeadAlertsArea {...msg} telegram={await telegramStatus()} />;
    case "google-calendar":
      return <GoogleCalendarArea {...msg} google={await googleCalendarStatus()} redirectUri={`${siteUrl()}/api/admin/google-calendar/callback`} />;
    case "calls":
      return <CallsArea {...msg} s={await getSettings()} timeZone={TZ} />;
    case "availability":
      return <AvailabilityArea {...msg} windows={await listAvailability()} weekdays={WEEKDAY_NAMES} timeZone={TZ} />;
    case "trial":
      return <TrialArea {...msg} trialDays={(await getSettings()).trialDays} />;
    case "loading":
      return <LoadingArea {...msg} pageLoader={(await getSettings()).pageLoader} />;
  }
}
