import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Every 5 minutes: publish due posts. Netlify only (worker.ts runs it every minute): an owner decision to stay inside
// the free plan's 300 credits. The publisher claims every post due up to now, so a post scheduled between two runs
// goes out at the next one; the composer and calendar say "within 5 minutes" (NETLIFY_PUBLISH_EVERY_MINUTES).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/publish", context);
}

export const config: NetlifyConfig = { schedule: "*/5 * * * *" };
