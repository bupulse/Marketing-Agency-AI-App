import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Daily at 05:41 UTC: Mobile Money renewal reminders and grace period (cursor calls). Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/momo-renewals", context);
}

export const config: NetlifyConfig = { schedule: "41 5 * * *" };
