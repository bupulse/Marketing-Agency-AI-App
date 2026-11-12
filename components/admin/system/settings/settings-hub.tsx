import { ArrowLeftRight, BellRing, CalendarDays, Clock3, CloudDownload, CreditCard, Gift, Globe, LoaderCircle, Mic, Percent, PhoneCall, Settings, Smartphone, Sparkles, Target } from "lucide-react";
import { PageHeader, SectionCard, SectionGrid } from "@/components/admin/kit";
import { Section } from "@/components/admin/ui";
import { HashRedirect } from "../hash-redirect";
import { Notices } from "../notices";
import { OLD_SETTINGS_ANCHORS, SETTINGS_TITLE, settingsHref } from "../settings-areas";

export type SettingsHubData = {
  momoReady: boolean;
  paddleReady: boolean;
  paddleLive: boolean;
  vatEnabled: boolean;
  vatRatePercent: number;
  vatTin: string;
  usdToRwf: number;
  displayCurrency: string;
  revenueGoalRwf: number;
  dailyPosts: boolean;
  skitVideos: boolean;
  voicesApproved: number;
  voicesTotal: number;
  telegram: "connected" | "not_connected" | "off";
  google: "connected" | "reconnect" | "not_connected" | "not_set_up";
  slotMinutes: number;
  windows: number;
  trialDays: number;
  pageLoader: string;
  /** Regions and prices needs plans.manage. */
  canRegions: boolean;
};

const LOADER: Record<string, string> = { bar: "Bar", preloader: "Logo", off: "Off" };
const short = (n: number) => (n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Admin -> Settings: one card per settings area, each opening its own small page. */
export function SettingsHub({ d, ok, bad }: { d: SettingsHubData; ok?: string; bad?: string }) {
  return (
    <>
      <HashRedirect routes={OLD_SETTINGS_ANCHORS} />
      <PageHeader icon={Settings} tone="slate" title="Settings" description="How BuPulse works for your clients and for you. Tap a card to change it; every change is written to the audit log." />
      <Notices ok={ok} bad={bad} />

      <Section title="Getting paid" description="How clients pay you, what card prices are, and the goal you track.">
        <SectionGrid>
          <SectionCard row href={settingsHref("momo")} icon={Smartphone} tone="green" title={SETTINGS_TITLE.momo} hint="The MoMo Pay code, numbers and name clients see when they pay." value={d.momoReady ? "Offered" : "Not set up"} valueLabel={d.momoReady ? "to clients" : "clients cannot pay by MoMo"} count={d.momoReady ? undefined : 1} countLabel="Mobile Money is not set up" />
          <SectionCard row href={settingsHref("paddle")} icon={CreditCard} tone="green" title={SETTINGS_TITLE.paddle} hint="Connect Paddle so clients can pay by card." value={d.paddleReady ? "Ready" : "Not set up"} valueLabel={d.paddleLive ? "live account" : "sandbox (testing)"} />
          <SectionCard row href={settingsHref("vat")} icon={Percent} tone="green" title={SETTINGS_TITLE.vat} hint="VAT added to RWF prices, and BuPulse's TIN on receipts." value={d.vatEnabled ? `${d.vatRatePercent}%` : "Off"} valueLabel={d.vatEnabled ? (d.vatTin ? "on RWF prices" : "on RWF prices · TIN missing") : "clients pay no VAT"} count={d.vatEnabled && !d.vatTin ? 1 : undefined} countLabel="Add BuPulse's TIN" />
          <SectionCard row href={settingsHref("currency")} icon={ArrowLeftRight} tone="green" title={SETTINGS_TITLE.currency} hint="The RWF rate and margin for card prices, and the currency the admin shows." value={`${d.usdToRwf.toLocaleString("en-US")} RWF`} valueLabel={`per US dollar · admin in ${d.displayCurrency}`} />
          {d.canRegions && <SectionCard row href="/admin/settings/regions" icon={Globe} tone="green" title="Regions and prices" hint="Which plans, prices and payment methods each country gets." />}
          <SectionCard row href={settingsHref("goal")} icon={Target} tone="green" title={SETTINGS_TITLE.goal} hint="The monthly income the goal tracker on Revenue measures against." value={`${short(d.revenueGoalRwf)} RWF`} valueLabel="a month" />
        </SectionGrid>
      </Section>

      <Section title="Clients' posts and videos" description="What BuPulse makes for clients by itself, and the voices it speaks with.">
        <SectionGrid>
          <SectionCard row href={settingsHref("content")} icon={Sparkles} tone="pink" title={SETTINGS_TITLE.content} hint="Switch the nightly posts, skit videos and the free preview on or off." value={d.dailyPosts ? "On" : "Paused"} valueLabel={`daily posts · skit videos ${d.skitVideos ? "on" : "off"}`} />
          <SectionCard row href={settingsHref("voices")} icon={Mic} tone="pink" title={SETTINGS_TITLE.voices} hint="The approved voice for videos in Kinyarwanda and Swahili." value={`${d.voicesApproved} of ${d.voicesTotal}`} valueLabel="languages have a voice" />
        </SectionGrid>
      </Section>

      <Section title="Calls and leads" description="Alerts when someone asks for a quote, and the calls clients book with you.">
        <SectionGrid>
          <SectionCard row href={settingsHref("lead-alerts")} icon={BellRing} tone="orange" title={SETTINGS_TITLE["lead-alerts"]} hint="Get every quote request and website chat on your phone, free." value={d.telegram === "connected" ? "Connected" : d.telegram === "off" ? "Switched off" : "Not connected"} valueLabel={d.telegram === "connected" ? "alerts reach Telegram" : "alerts go by email only"} />
          <SectionCard
            row
            href={settingsHref("google-calendar")}
            icon={CalendarDays}
            tone="orange"
            title={SETTINGS_TITLE["google-calendar"]}
            hint="Busy times come off the booking page; each booking gets a Meet link."
            value={d.google === "connected" ? "Connected" : d.google === "reconnect" ? "Reconnect" : "Not connected"}
            valueLabel={d.google === "reconnect" ? "Google refused the saved login" : d.google === "not_set_up" ? "needs a one-time set-up" : undefined}
            count={d.google === "reconnect" ? 1 : undefined}
            countLabel="Google Calendar needs reconnecting"
          />
          <SectionCard row href={settingsHref("calls")} icon={PhoneCall} tone="orange" title={SETTINGS_TITLE.calls} hint="The meeting link, call length, gaps and days off." value={`${d.slotMinutes} min`} valueLabel="per call" />
          <SectionCard row href={settingsHref("availability")} icon={Clock3} tone="orange" title={SETTINGS_TITLE.availability} hint="Your weekly hours. Slots are cut from these." value={String(d.windows)} valueLabel={d.windows === 1 ? "time window a week" : "time windows a week"} count={d.windows === 0 ? 1 : undefined} countLabel="Nobody can book a call" />
        </SectionGrid>
      </Section>

      <Section title="The site" description="Sign-ups, the look while pages load, and the version that runs.">
        <SectionGrid>
          <SectionCard row href={settingsHref("trial")} icon={Gift} tone="slate" title={SETTINGS_TITLE.trial} hint="How long a new client tries BuPulse for free." value={`${d.trialDays} days`} valueLabel="free" />
          <SectionCard row href={settingsHref("loading")} icon={LoaderCircle} tone="slate" title={SETTINGS_TITLE.loading} hint="What visitors see while a page loads." value={LOADER[d.pageLoader] ?? d.pageLoader} valueLabel="on every page" />
          <SectionCard row href="/admin/settings/updates" icon={CloudDownload} tone="slate" title="Updates" hint="The version running now, new releases, install or roll back." />
        </SectionGrid>
      </Section>
    </>
  );
}
