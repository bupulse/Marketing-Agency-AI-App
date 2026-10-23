import { uploadBody } from "@/lib/support/contract";
import { json, parse, readJson, route } from "@/lib/support/http";
import { createUpload } from "@/lib/support/uploads";
import { requireVisit } from "@/lib/support/visits";

export const POST = route(async (request, ctx: RouteContext<"/api/support/v1/conversations/[id]/uploads">) => {
  const session = await requireVisit(request.headers);
  const { id } = await ctx.params;
  return json(await createUpload(session, id, parse(uploadBody, await readJson(request))));
});
