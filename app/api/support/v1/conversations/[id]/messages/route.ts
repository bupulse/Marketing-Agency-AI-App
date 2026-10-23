import { sendMessageBody } from "@/lib/support/contract";
import { sendMessage, visitorMessages } from "@/lib/support/conversations";
import { json, parse, readJson, route } from "@/lib/support/http";
import { requireVisit } from "@/lib/support/visits";
import { clientIpHash } from "@/lib/widget/request";

export const maxDuration = 60;

type Ctx = RouteContext<"/api/support/v1/conversations/[id]/messages">;

export const GET = route(async (request, ctx: Ctx) => {
  const session = await requireVisit(request.headers);
  const { id } = await ctx.params;
  return json(await visitorMessages(session, id, request.nextUrl.searchParams.get("after")));
});

export const POST = route(async (request, ctx: Ctx) => {
  const session = await requireVisit(request.headers);
  const { id } = await ctx.params;
  const body = parse(sendMessageBody, await readJson(request));
  const { ip, hash } = await clientIpHash(request);
  return json(await sendMessage(session, id, body, { ip, ipHash: hash }));
});
