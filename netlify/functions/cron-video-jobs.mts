import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Every 4 minutes: Video Studio designs whose request died are failed and refunded once. Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/video-jobs", context);
}

export const config: NetlifyConfig = { schedule: "*/4 * * * *" };
