import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Hourly at :53: trial-end reminders and trial expiry. Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/trial-reminders", context);
}

export const config: NetlifyConfig = { schedule: "53 * * * *" };
