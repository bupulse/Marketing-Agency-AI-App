import { requireSupportAgent } from "@/lib/support/agent-auth";
import { agentTyping } from "@/lib/support/agent-inbox";
import { noContent, route } from "@/lib/support/http";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/agent/conversations/[id]/typing">) => {
  const agent = await requireSupportAgent(request);
  await agentTyping(agent, (await ctx.params).id);
  return noContent();
});
