import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Daily at 03:19: deletes content video files 30 days after their posts went out. Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/media-cleanup", context);
}

export const config: NetlifyConfig = { schedule: "19 3 * * *" };
