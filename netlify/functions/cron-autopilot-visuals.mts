import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Every 10 minutes from Friday to Sunday: the AI pictures Autopilot left for later (Netlify's 60 s) are made one step
// at a time (cursor calls). Same schedule as worker.ts (UTC). An idle run is one small database read.
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/autopilot-visuals", context);
}

export const config: NetlifyConfig = { schedule: "*/10 * * * 5,6,0" };
