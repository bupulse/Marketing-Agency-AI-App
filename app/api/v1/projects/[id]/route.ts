import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { legacyProjectJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// DEPRECATED (docs/API.md): a project's id is now its product's or campaign's id. Answers in the old shape.
// GET /api/v1/projects/:id   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, _request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  const include = { _count: { select: { photos: true } } };
  const product = await prisma.product.findFirst({ where: { id, businessId: ctx.businessId }, include });
  if (product) return apiJson({ data: legacyProjectJson({ product }) });
  const campaign = await prisma.campaign.findFirst({ where: { id, businessId: ctx.businessId }, include });
  if (campaign) return apiJson({ data: legacyProjectJson({ campaign }) });
  return apiError(404, "not_found", "No project with that id.");
});
