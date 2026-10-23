import { ratingBody } from "@/lib/support/contract";
import { rateConversation } from "@/lib/support/conversations";
import { noContent, parse, readJson, route } from "@/lib/support/http";
import { requireVisit } from "@/lib/support/visits";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/conversations/[id]/rating">) => {
  const session = await requireVisit(request.headers);
  const { id } = await ctx.params;
  await rateConversation(session, id, parse(ratingBody, await readJson(request)));
  return noContent();
});
