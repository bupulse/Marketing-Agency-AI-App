import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Every 3 hours on Fridays and Saturdays: Autopilot plans next week (cursor calls). Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/autopilot", context);
}

export const config: NetlifyConfig = { schedule: "11 */3 * * 5,6" };
