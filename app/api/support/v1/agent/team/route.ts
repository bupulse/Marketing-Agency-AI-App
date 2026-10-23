import { team } from "@/lib/support/agent-account";
import { requireSupportAgent } from "@/lib/support/agent-auth";
import { json, route } from "@/lib/support/http";

export const GET = route(async (request) => {
  await requireSupportAgent(request);
  return json(await team());
});
