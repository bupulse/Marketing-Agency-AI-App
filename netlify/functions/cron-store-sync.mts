import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Daily at 03:47 UTC: re-sync imported store products (cursor calls). Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/store-sync", context);
}

export const config: NetlifyConfig = { schedule: "47 3 * * *" };
