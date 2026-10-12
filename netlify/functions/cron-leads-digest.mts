import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Hourly at :37: the leads summary for businesses where it is 08:00, and webhook retries. Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/leads-digest", context);
}

export const config: NetlifyConfig = { schedule: "37 * * * *" };
