import { handleRunnerRequest, type NetlifyContext } from "../lib/cron";

// The background function the scheduled cron-* functions hand their job to (netlify/lib/cron.ts). The "-background"
// suffix makes it a Netlify Background Function: the caller gets 202 at once and this runs for up to 15 minutes.
// Only POST with `Authorization: Bearer $CRON_SECRET` and a known job path does anything.
export default async function handler(request: Request, context: NetlifyContext) {
  await handleRunnerRequest(request, context);
}
