import { removeDevice } from "@/lib/support/agent-account";
import { requireSupportAgent } from "@/lib/support/agent-auth";
import { noContent, route } from "@/lib/support/http";

export const DELETE = route(async (request, ctx: RouteContext<"/api/support/v1/agent/devices/[id]">) => {
  const agent = await requireSupportAgent(request);
  await removeDevice(agent, (await ctx.params).id);
  return noContent();
});
