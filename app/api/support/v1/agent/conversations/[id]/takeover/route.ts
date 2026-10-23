import { requireSupportAgent } from "@/lib/support/agent-auth";
import { takeover } from "@/lib/support/agent-inbox";
import { json, route } from "@/lib/support/http";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/agent/conversations/[id]/takeover">) => {
  const agent = await requireSupportAgent(request);
  return json(await takeover(agent, (await ctx.params).id));
});
