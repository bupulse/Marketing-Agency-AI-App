import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Every minute: publish due posts. Same schedule as worker.ts (UTC).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/publish", context);
}

export const config: NetlifyConfig = { schedule: "* * * * *" };
