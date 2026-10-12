import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Hourly at :23: collect post metrics (each post at most once every 20 hours). Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/metrics", context);
}

export const config: NetlifyConfig = { schedule: "23 * * * *" };
