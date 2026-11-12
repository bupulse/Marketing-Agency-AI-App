import { can, requirePermission } from "@/lib/admin/auth";
import { listAvailability } from "@/lib/admin/availability";
import { param } from "@/lib/admin/format";
import { getSettings } from "@/lib/admin/settings";
import { googleCalendarStatus } from "@/lib/google-calendar/calendar";
import { telegramStatus } from "@/lib/lead-alerts/telegram-settings";
import { approvedVoices } from "@/lib/content-languages/service";
import { APPROVAL_LANGUAGES } from "@/lib/content-languages/voice";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { momoConfigured } from "@/lib/billing/momo-shared";
import { paddleStatus } from "@/lib/billing/paddle-setup";
import { getVatSettings } from "@/lib/billing/vat-server";
import { SettingsHub } from "@/components/admin/system/settings/settings-hub";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Admin -> Settings: a card per settings area, each opening its own page under /admin/settings/<area>
 * (components/admin/system/settings-areas.ts). Old #anchor links open the right page (HashRedirect).
 */
export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const me = await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [s, windows, google, momo, paddle, telegram, voices, vat] = await Promise.all([getSettings(), listAvailability(), googleCalendarStatus(), getMomoSettings(), paddleStatus(), telegramStatus(), approvedVoices(), getVatSettings()]);
  // The VAT rate is per region (Admin -> Regions); the card shows Rwanda's (RWF), the TIN is the setting.
  const vatRatePercent = vat.rates.RWF ?? 0;
  return (
    <SettingsHub
      ok={param(sp.notice)}
      bad={param(sp.error)}
      d={{
        momoReady: momoConfigured(momo),
        paddleReady: paddle.ready,
        paddleLive: paddle.environment === "production",
        vatEnabled: vatRatePercent > 0,
        vatRatePercent,
        vatTin: vat.tin,
        usdToRwf: s.usdToRwf,
        displayCurrency: s.displayCurrency,
        revenueGoalRwf: s.revenueGoalRwf,
        dailyPosts: s.dailyPosts,
        skitVideos: s.skitVideos,
        voicesApproved: APPROVAL_LANGUAGES.filter((l) => voices[l]).length,
        voicesTotal: APPROVAL_LANGUAGES.length,
        telegram: !telegram.enabled ? "off" : telegram.chat && telegram.hasToken ? "connected" : "not_connected",
        google: !google.configured ? "not_set_up" : google.needsReconnect ? "reconnect" : google.connected ? "connected" : "not_connected",
        slotMinutes: s.slotMinutes,
        windows: windows.length,
        trialDays: s.trialDays,
        pageLoader: s.pageLoader,
        canRegions: can(me, "plans.manage"),
      }}
    />
  );
}
