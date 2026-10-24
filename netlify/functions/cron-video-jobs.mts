import { startCron, type NetlifyConfig, type NetlifyContext } from "../lib/cron";

// Every 10 minutes on Netlify (every 4 on Cloudflare, worker-crons.ts): Video Studio designs whose request died are failed
// and refunded once, overnight AI clips are started and checked, "video ready" emails go out. Slower here to save the
// free plan's credits (NETLIFY_VIDEO_JOBS_EVERY_MINUTES in lib/platform/limits.ts; tests/netlify-crons.test.ts checks it).
export default async function handler(_request: Request, context: NetlifyContext) {
  await startCron("/api/cron/video-jobs", context);
}

export const config: NetlifyConfig = { schedule: "*/10 * * * *" };
