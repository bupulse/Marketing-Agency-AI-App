import { requireSupportAgent } from "@/lib/support/agent-auth";
import { conversationDetail } from "@/lib/support/agent-inbox";
import { json, route } from "@/lib/support/http";

export const GET = route(async (request, ctx: RouteContext<"/api/support/v1/agent/conversations/[id]">) => {
  const agent = await requireSupportAgent(request);
  return json(await conversationDetail(agent, (await ctx.params).id));
});
