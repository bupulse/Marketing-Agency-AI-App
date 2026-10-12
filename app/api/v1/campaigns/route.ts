import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { campaignJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { CAMPAIGN_TYPES } from "@/lib/knowledge/campaigns";

// GET /api/v1/campaigns?type=event|offer|promotion|launch|other&limit=&cursor=   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const type = params.get("type")?.toUpperCase();
  if (type && !(CAMPAIGN_TYPES as readonly string[]).includes(type)) return apiError(400, "invalid_request", "type must be event, offer, promotion, launch or other.");
  const rows = await prisma.campaign.findMany({
    where: { businessId: ctx.businessId, ...(type ? { type: type as (typeof CAMPAIGN_TYPES)[number] } : {}) },
    include: { _count: { select: { photos: true } }, products: { select: { productId: true } } },
    ...pageArgs(paging),
  });
  const page = toPage(rows, paging.limit);
  return apiJson({ data: page.data.map(campaignJson), nextCursor: page.nextCursor });
});
