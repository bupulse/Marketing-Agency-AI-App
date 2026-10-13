import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Hourly at :07: the daily email of auto-scheduled posts, from 08:00 local per business. Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/content-summary", context);
}

export const config: NetlifyConfig = { schedule: "7 * * * *" };
