import { json, route } from "@/lib/support/http";
import { finishUpload } from "@/lib/support/uploads";
import { requireVisit } from "@/lib/support/visits";

// A voice note's transcript is made here, before the message is sent.
export const maxDuration = 60;

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/conversations/[id]/uploads/[aid]/done">) => {
  const session = await requireVisit(request.headers);
  const { id, aid } = await ctx.params;
  return json(await finishUpload(session, id, aid));
});
