import { typingBody } from "@/lib/support/contract";
import { visitorTyping } from "@/lib/support/conversations";
import { noContent, parse, readJson, route } from "@/lib/support/http";
import { requireVisit } from "@/lib/support/visits";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/conversations/[id]/typing">) => {
  const session = await requireVisit(request.headers);
  const { id } = await ctx.params;
  const body = parse(typingBody, await readJson(request).catch(() => ({})));
  await visitorTyping(session, id, body.draft);
  return noContent();
});
