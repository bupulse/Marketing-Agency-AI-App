import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Daily at 02:17 UTC: analytics roll-up and back-fill (cursor calls). Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/analytics-rollup", context);
}

export const config: NetlifyConfig = { schedule: "17 2 * * *" };
