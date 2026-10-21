// The Cloudflare cron schedules and the route each one calls (worker.ts runs them; wrangler.jsonc triggers them).
// Kept out of worker.ts on purpose: every named export of a Worker's main module must be an entrypoint, and a string
// there stops workerd from starting. Each schedule must appear in "triggers.crons" in wrangler.jsonc
// (tests/worker-crons.test.ts checks both ways).
/** Every minute: publish due posts. */
export const PUBLISH_CRON = "* * * * *";
/** Hourly: collect post metrics; each post is measured at most once every 20 hours. */
export const METRICS_CRON = "23 * * * *";
/** Autopilot plans next week on Fridays and Saturdays. */
export const AUTOPILOT_CRON = "11 */3 * * 5,6";
/** Hourly; the route only sends the leads summary to businesses where it is 08:00. */
export const LEADS_DIGEST_CRON = "37 * * * *";
/** Daily at 03:47 UTC: re-sync imported Shopify and WooCommerce products (a few stores per call, with a cursor). */
export const STORE_SYNC_CRON = "47 3 * * *";

/** Daily at 02:17 UTC: analytics roll-up for yesterday and today, plus back-fill days (cursor calls). */
export const ANALYTICS_ROLLUP_CRON = "17 2 * * *";

/** Daily at 04:29 UTC: plan price changes (notice emails, moving clients to the new price before renewal), cursor calls. */
export const PLAN_PRICE_CRON = "29 4 * * *";

/** Daily at 05:41 UTC: Mobile Money renewal reminders and the grace period (read-only after it), cursor calls. */
export const MOMO_RENEWALS_CRON = "41 5 * * *";
/** Hourly at :53: trial-end reminders (a day before and on the last day) and trials that are over become read-only. */
export const TRIAL_CRON = "53 * * * *";
/** Daily at 03:19: content video files are deleted 30 days after their posts went out (docs/CONTENT_VISUALS.md). */
export const MEDIA_CLEANUP_CRON = "19 3 * * *";
/** Hourly at :07: the daily email of posts auto-approval scheduled, sent from 08:00 local (docs/CONTENT.md). */
export const CONTENT_SUMMARY_CRON = "7 * * * *";
/** Every 4 minutes: Video Studio designs whose request died are failed and refunded once (docs/VIDEO_APP_INTEGRATION.md). */
export const VIDEO_JOBS_CRON = "*/4 * * * *";
/** Hourly at :13: daily posts made for you, from local midnight until midday per company (docs/CONTENT.md), cursor calls. */
export const DAILY_POSTS_CRON = "13 * * * *";
/** Every 6 hours at :31: creators' post views, link checks, period closes and payouts (docs/CREATOR_CAMPAIGNS.md), cursor calls. */
export const CREATOR_VIEWS_CRON = "31 */6 * * *";

export const CRON_ROUTES: Record<string, string> = {
  [PUBLISH_CRON]: "/api/cron/publish",
  [METRICS_CRON]: "/api/cron/metrics",
  [AUTOPILOT_CRON]: "/api/cron/autopilot",
  [LEADS_DIGEST_CRON]: "/api/cron/leads-digest",
  [STORE_SYNC_CRON]: "/api/cron/store-sync",
  [ANALYTICS_ROLLUP_CRON]: "/api/cron/analytics-rollup",
  [PLAN_PRICE_CRON]: "/api/cron/plan-price-changes",
  [MOMO_RENEWALS_CRON]: "/api/cron/momo-renewals",
  [TRIAL_CRON]: "/api/cron/trial-reminders",
  [MEDIA_CLEANUP_CRON]: "/api/cron/media-cleanup",
  [CONTENT_SUMMARY_CRON]: "/api/cron/content-summary",
  [VIDEO_JOBS_CRON]: "/api/cron/video-jobs",
  [DAILY_POSTS_CRON]: "/api/cron/daily-posts",
  [CREATOR_VIEWS_CRON]: "/api/cron/creator-views",
};

/** The route for a schedule, or null for one this worker doesn't know (never fall back to publishing). */
export function routeForCron(cron: string): string | null {
  return CRON_ROUTES[cron] ?? null;
}

