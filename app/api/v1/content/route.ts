import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { contentJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// GET /api/v1/content?projectId=&limit=&cursor=   (scope content:read)
export const GET = apiRoute("content:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const projectId = params.get("projectId");
  // Content belongs to a project, and the project to the business: that is the only path to it.
  const rows = await prisma.generatedContent.findMany({ where: { project: { businessId: ctx.businessId }, ...(projectId ? { projectId } : {}) }, ...pageArgs(paging) });
  const page = toPage(rows, paging.limit);
  return apiJson({ data: page.data.map(contentJson), nextCursor: page.nextCursor });
});
