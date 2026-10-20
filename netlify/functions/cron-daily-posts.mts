import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Hourly at :13: daily posts made for you, from local midnight to midday per company (cursor calls). Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/daily-posts", context);
}

export const config: NetlifyConfig = { schedule: "13 * * * *" };
