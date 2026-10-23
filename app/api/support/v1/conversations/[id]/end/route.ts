import { endConversation } from "@/lib/support/conversations";
import { noContent, route } from "@/lib/support/http";
import { requireVisit } from "@/lib/support/visits";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/conversations/[id]/end">) => {
  const session = await requireVisit(request.headers);
  const { id } = await ctx.params;
  await endConversation(session, id);
  return noContent();
});
