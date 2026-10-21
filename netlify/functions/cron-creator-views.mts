import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Every 6 hours at :31: creators' post views, link checks, period closes and payouts (cursor calls). Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/creator-views", context);
}

export const config: NetlifyConfig = { schedule: "31 */6 * * *" };
