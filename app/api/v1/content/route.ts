import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { contentJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// GET /api/v1/content?productId=&campaignId=&projectId=&limit=&cursor=   (scope content:read)
// projectId (deprecated) is the product's or campaign's id, so it matches either.
export const GET = apiRoute("content:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const productId = params.get("productId");
  const campaignId = params.get("campaignId");
  const projectId = params.get("projectId");
  const rows = await prisma.generatedContent.findMany({
    where: {
      businessId: ctx.businessId,
      ...(productId ? { productId } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(projectId ? { OR: [{ productId: projectId }, { campaignId: projectId }, { projectId }] } : {}),
    },
    ...pageArgs(paging),
  });
  const page = toPage(rows, paging.limit);
  return apiJson({ data: page.data.map(contentJson), nextCursor: page.nextCursor });
});
