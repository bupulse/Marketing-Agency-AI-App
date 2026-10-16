import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Daily at 04:29 UTC: plan price changes (cursor calls). Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/plan-price-changes", context);
}

export const config: NetlifyConfig = { schedule: "29 4 * * *" };
