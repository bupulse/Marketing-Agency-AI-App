import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { projectJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// GET /api/v1/projects?type=&limit=&cursor=   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const type = params.get("type");
  const rows = await prisma.project.findMany({ where: { businessId: ctx.businessId, ...(type ? { type } : {}) }, ...pageArgs(paging) });
  const page = toPage(rows, paging.limit);
  return apiJson({ data: page.data.map(projectJson), nextCursor: page.nextCursor });
});
