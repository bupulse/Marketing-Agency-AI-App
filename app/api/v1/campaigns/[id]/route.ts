import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { campaignJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// GET /api/v1/campaigns/:id   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, _request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  const campaign = await prisma.campaign.findFirst({ where: { id, businessId: ctx.businessId }, include: { _count: { select: { photos: true } }, products: { select: { productId: true } } } });
  if (!campaign) return apiError(404, "not_found", "No campaign with that id.");
  return apiJson({ data: campaignJson(campaign) });
});
