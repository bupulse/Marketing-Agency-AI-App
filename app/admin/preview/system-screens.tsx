// Development only (app/admin/preview): the System and Organisation pages of the admin redesign (round 2, part A) with
// made-up data, no database and no sign-in. /admin/preview/settings, /admin/preview/settings-area?area=paddle,
// /admin/preview/services?show=attention, /admin/preview/service?id=elevenlabs ...
import type { ServiceView, EnvState } from "@/lib/admin/services";
import type { SearchParamsLike } from "@/components/admin/kit";
import { chosen } from "@/components/admin/kit";
import { SettingsHub } from "@/components/admin/system/settings/settings-hub";
import { CurrencyArea, GoalArea, MomoArea, PaddleArea } from "@/components/admin/system/settings/money-areas";
import { ContentArea, VoicesArea } from "@/components/admin/system/settings/content-areas";
import { AvailabilityArea, CallsArea, GoogleCalendarArea, LeadAlertsArea } from "@/components/admin/system/settings/calls-areas";
import { LoadingArea, TrialArea } from "@/components/admin/system/settings/site-areas";
import { isSettingsSlug, type SettingsSlug } from "@/components/admin/system/settings-areas";
import { ServicesGrid, type ServiceCardData } from "@/components/admin/system/services/services-grid";
import { ServiceDetail } from "@/components/admin/system/services/service-detail";
import { CustomKeysPage, InboxServicePage, VideoRobotPage } from "@/components/admin/system/services/more-services";
import { SERVICE_FILTERS, type ServiceFilter } from "@/components/admin/system/services/service-status";
import { HealthView } from "@/components/admin/system/health-view";
import { AuditView, ErrorsView } from "@/components/admin/system/logs-view";
import { FlagsView } from "@/components/admin/system/flags-view";
import { UpdatesView } from "@/components/admin/system/updates-view";
import { RegionsView } from "@/components/admin/system/regions-view";
import { StaffView } from "@/components/admin/organisation/staff-view";
import { RolesView } from "@/components/admin/organisation/roles-view";
import { ScreenView } from "@/components/admin/organisation/screen-view";
import type { SystemHealth } from "@/lib/admin/health";
import type { RoleView } from "@/lib/staff/service";
import type { Permission } from "@/lib/staff/permissions";
import { changeStaffRoleAction, deleteRoleAction, inviteStaffAction, removeStaffAction, saveRoleAction, setStaffDisabledAction } from "@/app/admin/(console)/(organisation)/organisation/actions";

export const SYSTEM_SCREENS = ["settings", "settings-area", "services", "service", "service-more", "health", "errors", "audit", "flags", "updates", "regions", "staff", "roles", "screen"] as const;
export type SystemScreen = (typeof SYSTEM_SCREENS)[number];
export const isSystemScreen = (s: string): s is SystemScreen => (SYSTEM_SCREENS as readonly string[]).includes(s);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const HOUR = 3_600_000;
const NOW = new Date("2026-11-10T09:30:00Z");
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();

/** The path the shell highlights for a preview screen. */
export function systemPreviewPath(which: SystemScreen, sp: SearchParamsLike): string {
  if (which === "settings") return "/admin/settings";
  if (which === "settings-area") return `/admin/settings/${first(sp.area) || "momo"}`;
  const paths: Partial<Record<SystemScreen, string>> = { health: "/admin/health", errors: "/admin/errors", audit: "/admin/audit", flags: "/admin/flags", updates: "/admin/settings/updates", regions: "/admin/settings/regions", staff: "/admin/organisation", roles: "/admin/organisation/roles", screen: "/admin/organisation/screen" };
  return paths[which] ?? "/admin/services";
}

const env = (name: string, source: EnvState["source"], shown: string | null = null): EnvState => ({ name, set: source !== null, source, shown, savedAt: source === "saved" ? at(30) : null, savedBy: source === "saved" ? "admin" : null, hostSet: false });

const SERVICES: ServiceView[] = [
  { id: "elevenlabs", name: "ElevenLabs", purpose: "Speaks the voiceover of content videos (text to speech).", features: ["Voiceover on videos", "Video Studio voice-overs (coming soon)"], killable: true, whenOff: "Videos are made without a voiceover, with captions and music only.", env: [env("ELEVENLABS_API_KEY", "saved", "x9Qa")], optionalEnv: [env("ELEVENLABS_MODEL", null)], keysWhere: "here", configured: "configured", enabled: true, disabledReason: null, disabledBy: null, disabledAt: null, lastCheck: { ok: false, latencyMs: 412, message: "The key was refused (401).", checkedAt: at(2) }, lastError: { at: at(2), message: "ElevenLabs answered 401: invalid_api_key", source: "visuals:voiceover" }, usage: [{ label: "Calls, 30 days", value: 128 }, { label: "Failed, 30 days", value: 6 }], health: "down" },
  { id: "gemini", name: "Google Gemini", purpose: "Writes captions, ideas and replies, and reads images.", features: ["Captions", "Ideas"], killable: true, whenOff: "AI writing stops; clients see “temporarily unavailable”.", env: [env("GEMINI_API_KEY", "host")], optionalEnv: [], keysWhere: "here", configured: "configured", enabled: true, disabledReason: null, disabledBy: null, disabledAt: null, lastCheck: { ok: true, latencyMs: 230, message: null, checkedAt: at(1) }, lastError: null, usage: [{ label: "Calls, 30 days", value: "4,210" }, { label: "Cost, 30 days", value: "$3.12" }], health: "ok" },
  { id: "resend", name: "Resend", purpose: "Sends every email: sign-in codes, invoices, alerts.", features: ["Emails"], killable: false, whenOff: "No email can be sent.", env: [env("RESEND_API_KEY", "saved", "7hTe")], optionalEnv: [], keysWhere: "here", configured: "configured", enabled: true, disabledReason: null, disabledBy: null, disabledAt: null, lastCheck: { ok: true, latencyMs: 180, message: null, checkedAt: at(5) }, lastError: null, usage: [{ label: "Emails, 30 days", value: 912 }], health: "ok" },
  { id: "paddle", name: "Paddle", purpose: "Takes card payments and runs subscriptions.", features: ["Card payments"], killable: true, whenOff: "Card checkout shows as coming soon; Mobile Money still works.", env: [env("PADDLE_API_KEY", null)], optionalEnv: [], keysWhere: "settings", configured: "missing", enabled: true, disabledReason: null, disabledBy: null, disabledAt: null, lastCheck: null, lastError: null, usage: [], health: "not_connected" },
  { id: "seedance", name: "Seedance 2.0 (Higgsfield)", purpose: "Makes the talking skit videos from the client's voice notes.", features: ["Skit videos"], killable: true, whenOff: "Skits wait as “Voice received — video coming soon”.", env: [env("HIGGSFIELD_API_KEY", "saved", "Lm2p")], optionalEnv: [], keysWhere: "here", configured: "configured", enabled: false, disabledReason: "Lip-sync test not passed yet", disabledBy: "admin", disabledAt: at(70), lastCheck: { ok: true, latencyMs: 640, message: null, checkedAt: at(72) }, lastError: null, usage: [], health: "off" },
  { id: "telegram", name: "Telegram (lead alerts)", purpose: "Sends quote requests and website chats to your phone.", features: ["Lead alerts"], killable: true, whenOff: "Alerts go by email only.", env: [env("TELEGRAM_BOT_TOKEN", "saved", "aQ3k")], optionalEnv: [], keysWhere: "here", configured: "configured", enabled: true, disabledReason: null, disabledBy: null, disabledAt: null, lastCheck: null, lastError: null, usage: [], health: "untested" },
  { id: "canva", name: "Canva", purpose: "Opens designs in Canva for clients who want to edit them.", features: ["Edit in Canva"], killable: true, whenOff: "The Edit in Canva button is hidden.", env: [env("CANVA_CLIENT_ID", null), env("CANVA_CLIENT_SECRET", null)], optionalEnv: [], keysWhere: "here", configured: "missing", enabled: true, disabledReason: null, disabledBy: null, disabledAt: null, lastCheck: null, lastError: null, usage: [], health: "not_connected" },
  { id: "supabase", name: "Supabase", purpose: "The database and file storage.", features: ["Database", "Files"], killable: false, whenOff: "BuPulse cannot run.", env: [env("DATABASE_URL", "host"), env("SUPABASE_SERVICE_ROLE_KEY", "host")], optionalEnv: [], keysWhere: "host", configured: "configured", enabled: true, disabledReason: null, disabledBy: null, disabledAt: null, lastCheck: { ok: true, latencyMs: 35, message: null, checkedAt: at(0.2) }, lastError: null, usage: [], health: "ok" },
] as ServiceView[];

const card = (s: ServiceView): ServiceCardData => ({ id: s.id, name: s.name, purpose: s.purpose, health: s.health, whenOff: s.whenOff, lastCheck: s.lastCheck ? { ok: s.lastCheck.ok, checkedAt: s.lastCheck.checkedAt } : null });

const PADDLE = {
  ready: false,
  line: "Card payments: not set up — no plan has a Paddle price yet. Click Set up prices.",
  environment: "sandbox" as const,
  config: { source: { environment: "settings", apiKey: "settings", clientToken: "env", webhookSecret: null }, last4: { apiKey: "4f2a", clientToken: "91bc", webhookSecret: null } },
  regions: [
    { key: "RW", name: "Rwanda", priced: 0, total: 3 },
    { key: "GLOBAL", name: "Everywhere else", priced: 0, total: 3 },
  ],
} as unknown as Parameters<typeof PaddleArea>[0]["paddle"];

function SettingsAreaPreview({ slug, ok }: { slug: SettingsSlug; ok?: string }) {
  const tz = "Africa/Kigali".replace("_", " ");
  switch (slug) {
    case "momo":
      return <MomoArea ok={ok} momo={{ merchantCode: "002450", momoNumber: "0788 000 000", accountName: "BuPulse Ltd", airtelNumber: "" }} dial="*182*8*1*002450#" ready />;
    case "paddle":
      return <PaddleArea ok={ok} paddle={PADDLE} webhookUrl="https://bupulse.com/api/webhooks/paddle" />;
    case "currency":
      return <CurrencyArea ok={ok} s={{ usdToRwf: 1450, cardMarginPercent: 8, displayCurrency: "RWF", usdToEur: 0.92, eurRateAuto: true }} exampleCents={1200} eur={{ rate: 0.9213, source: "ecb", fetchedAt: at(6) }} />;
    case "goal":
      return <GoalArea ok={ok} revenueGoalRwf={9_000_000} goalStartMonth="2026-11" />;
    case "content":
      return <ContentArea ok={ok} dailyPosts dailyLine="Today (10 Nov): 12 companies, 31 posts made, 2 skipped (AI allowance used up), none failed." skitVideos={false} firstPostPreview={false} previewCost={{ model: "gemini-2.5-flash", estimateUsd: 0.0021, made: 0, averageUsd: null }} />;
    case "voices":
      return <VoicesArea ok={ok} languages={["Kinyarwanda", "Swahili"]} voices={{ Kinyarwanda: "pNInz6obpgDQGcFmaJgB", Swahili: null }} />;
    case "lead-alerts":
      return <LeadAlertsArea ok={ok} telegram={{ hasToken: true, enabled: true, chat: null }} />;
    case "google-calendar":
      return <GoogleCalendarArea ok={ok} google={{ configured: true, connected: true, email: "office@bupulse.com", calendarId: "primary", connectedAt: new Date(at(300)), lastError: null, lastErrorAt: null, needsReconnect: true }} redirectUri="https://bupulse.com/api/admin/google-calendar/callback" />;
    case "calls":
      return <CallsArea ok={ok} s={{ meetingLink: "https://meet.google.com/abc-defg-hij", organizerEmail: "office@bupulse.com", slotMinutes: 30, bufferMinutes: 15, demoDailyCap: 8, blockedDates: ["2026-12-25", "2027-01-01"] }} timeZone={tz} />;
    case "availability":
      return (
        <AvailabilityArea
          ok={ok}
          windows={[
            { id: "w1", weekday: 1, weekdayName: "Monday", start: "09:00", end: "12:00" },
            { id: "w2", weekday: 1, weekdayName: "Monday", start: "14:00", end: "17:00" },
            { id: "w3", weekday: 3, weekdayName: "Wednesday", start: "09:00", end: "17:00" },
          ]}
          weekdays={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]}
          timeZone={tz}
        />
      );
    case "trial":
      return <TrialArea ok={ok} trialDays={14} />;
    case "loading":
      return <LoadingArea ok={ok} pageLoader="bar" />;
  }
}

/** The preview of one System or Organisation screen. */
export function SystemPreview({ which, sp }: { which: SystemScreen; sp: SearchParamsLike }) {
  const ok = first(sp.notice) || undefined;
  if (which === "settings") {
    return <SettingsHub ok={ok} d={{ momoReady: true, paddleReady: false, paddleLive: false, usdToRwf: 1450, displayCurrency: "RWF", revenueGoalRwf: 9_000_000, dailyPosts: true, skitVideos: false, voicesApproved: 1, voicesTotal: 2, telegram: "not_connected", google: "reconnect", slotMinutes: 30, windows: 3, trialDays: 14, pageLoader: "bar", canRegions: true }} />;
  }
  if (which === "settings-area") {
    const area = first(sp.area) || "momo";
    return isSettingsSlug(area) ? <SettingsAreaPreview slug={area} ok={ok} /> : null;
  }
  if (which === "services") {
    return (
      <ServicesGrid
        now={NOW}
        services={SERVICES.map(card)}
        extras={{ inbox: { ready: true }, custom: { count: 2, broken: 1 }, robot: { label: "Working", tone: "good" } }}
        filter={chosen(sp, "show", SERVICE_FILTERS, "") as ServiceFilter}
        sp={sp}
        unreadable={[]}
        ok={ok}
      />
    );
  }
  if (which === "service") {
    const s = SERVICES.find((x) => x.id === first(sp.id)) ?? SERVICES[0];
    return <ServiceDetail s={s} ok={ok} now={NOW} />;
  }
  if (which !== "service-more") return <MorePreview which={which} sp={sp} ok={ok} />;
  const page = first(sp.page) || "custom-keys";
  if (page === "inbox") {
    return <InboxServicePage view={{ settings: { transport: "composio", monthlyCap: 20000, privateReplyConfirmed: false }, used: 6120, pollLimit: 19000, replyReserve: 1000, composioReady: true, metaReady: false, accounts: { composio: 9, direct: 0 }, pendingChecks: 3, webhookTokenSet: false } as Parameters<typeof InboxServicePage>[0]["view"]} />;
  }
  if (page === "video-robot") {
    return <VideoRobotPage robot={{ enabled: true, lastOk: true, lastRunAt: at(0.2), made24h: 14, failed24h: 1, runs24h: 96, waiting: 2, needsBrowser: 0 }} />;
  }
  return (
    <CustomKeysPage
      custom={[
        { id: "k1", envName: "SEEDREAM_API_KEY", label: "Seedream images", details: "Owner's BytePlus account, 200 free images a month.", website: "https://console.byteplus.com", shown: "Qa9z", savedAt: at(50), savedBy: "admin", inUse: true },
        { id: "k2", envName: "KLING_API_KEY", label: "Kling video test", details: "", website: null, shown: "0b1c", savedAt: at(400), savedBy: "admin", inUse: false },
      ]}
    />
  );
}

const CRONS = [
  { job: "publish", label: "Publish posts", what: "Posts what is due", via: "cloudflare", cron: "* * * * *", state: "ok", lastStartedAt: at(0.02), lastFinishedAt: at(0.02), lastOk: true, lastSummary: "3 posted", lastError: null, nextExpectedAt: at(-0.02), failures24h: 0, runs24h: 1440, overdueByMinutes: null },
  { job: "daily-posts", label: "Daily posts", what: "Makes the day's posts for clients", via: "github", cron: "0 1 * * *", state: "failed", lastStartedAt: at(8), lastFinishedAt: at(8), lastOk: false, lastSummary: null, lastError: "Gemini answered 429: quota exceeded", nextExpectedAt: at(-16), failures24h: 1, runs24h: 1, overdueByMinutes: null },
  { job: "uptime", label: "Uptime check", what: "Checks the site answers", via: "server", cron: "*/5 * * * *", state: "ok", lastStartedAt: at(0.05), lastFinishedAt: at(0.05), lastOk: true, lastSummary: "200 in 180 ms", lastError: null, nextExpectedAt: at(-0.05), failures24h: 0, runs24h: 288, overdueByMinutes: null },
  { job: "eur-rate", label: "EUR rate", what: "Fetches the ECB rate", via: "github", cron: "0 6 * * *", state: "never", lastStartedAt: null, lastFinishedAt: null, lastOk: null, lastSummary: null, lastError: null, nextExpectedAt: at(-20), failures24h: 0, runs24h: 0, overdueByMinutes: null },
] as unknown as SystemHealth["crons"];

const HEALTH: SystemHealth = {
  generatedAt: NOW.toISOString(),
  status: "warning",
  issues: [
    { level: "warning", key: "cron:daily-posts", text: "Daily posts failed on its last run (1 of 1 in 24 hours).", href: "/admin/health" },
    { level: "warning", key: "approvals", text: "A money request has waited 2 days for your approval.", href: "/admin/approvals" },
  ],
  crons: CRONS,
  queues: { postsOverdue: 0, postsStuck: 0, needsAction: 2, webhookPending: 4, webhookFailed24h: 1, webhookTotal24h: 37, pendingApprovals: 1, oldestApprovalHours: 51 },
  errors: {
    lastHour: 3,
    last24h: 22,
    perHour: Array.from({ length: 24 }, (_, i) => ({ hour: new Date(NOW.getTime() - (23 - i) * HOUR).toISOString(), count: [0, 0, 1, 0, 2, 0, 0, 0, 5, 1, 0, 0, 0, 3, 0, 0, 1, 0, 0, 2, 4, 0, 0, 3][i] })),
    top: [
      { source: "visuals:voiceover", message: "ElevenLabs answered 401: invalid_api_key", count: 9 },
      { source: "daily-posts", message: "Gemini answered 429: quota exceeded", count: 6 },
    ],
  },
  db: { sizeBytes: 182_000_000, limitBytes: 500_000_000, tables: [{ name: "ErrorLog", bytes: 61_000_000 }, { name: "Post", bytes: 44_000_000 }, { name: "AuditLog", bytes: 21_000_000 }] },
  storage: [{ bucket: "media", objects: 4120, bytes: 1_400_000_000 }, { bucket: "releases", objects: 6, bytes: 210_000_000 }],
};

const ROLES = [
  { key: "owner", name: "Owner", description: "Everything, including staff and money.", permissions: ["overview", "clients.view", "clients.manage", "system", "staff.manage"], builtIn: true, members: 0 },
  { key: "sales_agent", name: "Sales agent", description: "Their own clients, leads and quotes.", permissions: ["overview", "clients.own"], builtIn: true, members: 3 },
  { key: "support", name: "Support", description: "Live chat and every client, read-only money.", permissions: ["overview", "clients.view"], builtIn: true, members: 1 },
  { key: "night-support", name: "Night support", description: "Custom role.", permissions: ["overview", "clients.view"], builtIn: false, members: 1 },
] as RoleView[];

function MorePreview({ which, sp, ok }: { which: SystemScreen; sp: SearchParamsLike; ok?: string }) {
  switch (which) {
    case "health":
      return <HealthView h={HEALTH} services={{ failing: [{ key: "elevenlabs", label: "ElevenLabs", reason: "The key was refused (401)." }], off: [{ key: "seedance", label: "Seedance 2.0 (Higgsfield)", reason: "Switched off: Lip-sync test not passed yet" }] }} />;
    case "errors":
      return (
        <ErrorsView
          sp={sp}
          bad={null}
          more
          next="/admin/preview/errors"
          f={{ level: chosen(sp, "level", ["error", "warn"], ""), source: "", userId: "", days: chosen(sp, "days", ["1", "7", "30", "all"], "7") }}
          items={[
            { id: "e1", createdAt: at(0.3), level: "error", source: "visuals:voiceover", message: "ElevenLabs answered 401: invalid_api_key", userId: "u_123", context: { postId: "p_88", attempt: 2 } },
            { id: "e2", createdAt: at(2), level: "warn", source: "publishing:meta", message: "Instagram asked to reconnect the account (token expired).", userId: null, context: null },
            { id: "e3", createdAt: at(8), level: "error", source: "daily-posts", message: "Gemini answered 429: quota exceeded", userId: null, context: null },
          ]}
        />
      );
    case "audit":
      return (
        <AuditView
          bad={null}
          more={false}
          next={null}
          f={{ actor: "", action: "", target: "", since: "", until: "" }}
          items={[
            { id: "a1", createdAt: at(0.5), actor: "admin", action: "save_setting", target: "setting:trialDays", ip: "41.186.0.1", before: { trialDays: 7 }, after: { trialDays: 14 } },
            { id: "a2", createdAt: at(3), actor: "jarvis:ops", action: "extend_trial", target: "user:u_123", ip: null, before: { trialEndsAt: "2026-11-12" }, after: { trialEndsAt: "2026-11-19" } },
            { id: "a3", createdAt: at(26), actor: "admin", action: "service_switch", target: "service:seedance", ip: "41.186.0.1", before: null, after: null },
          ]}
        />
      );
    case "flags":
      return (
        <FlagsView
          ok={ok}
          flags={[
            { key: "new-composer", description: "The new post composer with AI suggestions.", enabled: true, rolloutPercent: 50, overrides: [{ userId: "u1", label: "keza@example.com", on: true }] },
            { key: "quiz-mode", description: "Business info as a short quiz.", enabled: false, rolloutPercent: 0, overrides: [] },
            { key: "creator-campaigns", description: null, enabled: true, rolloutPercent: 100, overrides: [] },
          ]}
        />
      );
    case "updates":
      return (
        <UpdatesView
          ok={ok}
          isOwner
          signingKey="key"
          dryRun={false}
          s={{
            current: { version: "2.4.1", sha: "abc1234def", short: "abc1234" },
            host: "cloudflare",
            connected: true,
            repo: "bupulse/bupulse",
            latest: { kind: "release", version: "2.5.0", ref: "v2.5.0", sha: "def5678abc", name: "Admin redesign", publishedAt: at(5), notes: "## What changed\n- Calmer admin pages with cards\n- Settings split into small pages", url: "https://github.com" },
            state: "update_available",
            runs: [],
            inFlight: null,
            error: null,
          }}
          releases={[{ id: "r1", version: "2.4.1", status: "installed", commit: "abc1234def", createdAt: new Date(at(48)), uploadedBy: "office@bupulse.com", installedAt: new Date(at(47)), installRequestedBy: "office@bupulse.com", notes: "Support chat fixes.", cloudflareVersionId: null, zipPath: "2.4.1.zip", backupPath: "2.4.1.dump", error: null }] as unknown as Parameters<typeof UpdatesView>[0]["releases"]}
        />
      );
    case "regions":
      return (
        <RegionsView
          ok={ok}
          d={
            {
              settings: { usdToRwf: 1450, cardMarginPercent: 8 },
              plans: [
                { key: "starter", name: "Starter", status: "active" },
                { key: "business", name: "Business", status: "active" },
                { key: "pro", name: "Business Pro", status: "active" },
              ],
              regions: [
                {
                  key: "RW",
                  name: "Rwanda",
                  currency: "RWF",
                  countries: ["RW"],
                  paymentMethods: ["momo", "card"],
                  active: true,
                  sortOrder: 10,
                  prices: [
                    { planKey: "starter", planName: "Starter", planStatus: "active", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11200, paddleMonthlyPriceId: null, paddleYearlyPriceId: null, fromPlan: false },
                    { planKey: "business", planName: "Business", planStatus: "active", currency: "RWF", monthlyMinor: 50000, yearlyMinor: 500000, cardMonthlyUsdCents: 3800, cardYearlyUsdCents: 37300, paddleMonthlyPriceId: "pri_1", paddleYearlyPriceId: "pri_2", fromPlan: false },
                  ],
                },
                { key: "GLOBAL", name: "Everywhere else", currency: "USD", countries: [], paymentMethods: ["card"], active: true, sortOrder: 99, prices: [{ planKey: "pro", planName: "Business Pro", planStatus: "active", currency: "USD", monthlyMinor: 4900, yearlyMinor: 49000, cardMonthlyUsdCents: 4900, cardYearlyUsdCents: 49000, paddleMonthlyPriceId: "pri_3", paddleYearlyPriceId: "pri_4", fromPlan: true }] },
              ],
            } as unknown as Parameters<typeof RegionsView>[0]["d"]
          }
        />
      );
    case "staff":
      return (
        <StaffView
          ok={ok}
          roles={ROLES}
          grantable={["sales_agent", "support", "night-support"]}
          me={{ staffId: null, email: "office@example.com" }}
          actions={{ invite: inviteStaffAction, changeRole: changeStaffRoleAction, setDisabled: setStaffDisabledAction, remove: removeStaffAction }}
          staff={[
            { id: "s1", email: "keza@example.com", name: "Keza Uwase", phone: null, roleKey: "sales_agent", roleName: "Sales agent", status: "active", refCode: "KEZA10", lastSignInAt: at(3), createdAt: at(500), invitedBy: "admin" },
            { id: "s2", email: "eric@example.com", name: "Eric Mugisha", phone: null, roleKey: "support", roleName: "Support", status: "invited", refCode: null, lastSignInAt: null, createdAt: at(20), invitedBy: "admin" },
            { id: "s3", email: "old@example.com", name: null, phone: null, roleKey: "sales_agent", roleName: "Sales agent", status: "disabled", refCode: "OLD5", lastSignInAt: at(900), createdAt: at(2000), invitedBy: "admin" },
          ]}
        />
      );
    case "roles":
      return <RolesView ok={ok} roles={ROLES} allowed={["overview", "clients.view", "clients.own", "system"] as Permission[]} actions={{ save: saveRoleAction, remove: deleteRoleAction }} />;
    case "screen":
      return (
        <ScreenView
          ok={ok}
          maxActive={5}
          maxSeconds={10}
          links={[
            { id: "l1", name: "Sales room TV", createdAt: at(400), lastSeenAt: at(0.02), revokedAt: null },
            { id: "l2", name: "Old office TV", createdAt: at(2000), lastSeenAt: at(900), revokedAt: at(800) },
          ]}
          sounds={[
            { id: "x1", name: "Cash register", source: "generated", bytes: 48_000, active: true, url: null },
            { id: "x2", name: "Crowd cheer", source: "uploaded", bytes: 210_000, active: false, url: null },
          ]}
        />
      );
    default:
      return null;
  }
}
