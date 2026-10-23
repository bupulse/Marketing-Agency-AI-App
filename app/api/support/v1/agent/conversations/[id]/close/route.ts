import { requireSupportAgent } from "@/lib/support/agent-auth";
import { closeConversation } from "@/lib/support/agent-inbox";
import { json, route } from "@/lib/support/http";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/agent/conversations/[id]/close">) => {
  const agent = await requireSupportAgent(request);
  return json(await closeConversation(agent, (await ctx.params).id));
});
