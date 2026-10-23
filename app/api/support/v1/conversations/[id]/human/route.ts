import { askForHuman } from "@/lib/support/conversations";
import { json, route } from "@/lib/support/http";
import { requireVisit } from "@/lib/support/visits";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/conversations/[id]/human">) => {
  const session = await requireVisit(request.headers);
  const { id } = await ctx.params;
  return json(await askForHuman(session, id));
});
