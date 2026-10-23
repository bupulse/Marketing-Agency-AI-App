import { requireSupportAgent } from "@/lib/support/agent-auth";
import { json, route } from "@/lib/support/http";
import { liveVisitors } from "@/lib/support/live";

export const GET = route(async (request) => {
  await requireSupportAgent(request);
  return json(await liveVisitors());
});
