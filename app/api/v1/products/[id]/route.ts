import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { productJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// GET /api/v1/products/:id   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, _request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  const product = await prisma.product.findFirst({ where: { id, businessId: ctx.businessId }, include: { _count: { select: { photos: true } } } });
  if (!product) return apiError(404, "not_found", "No product with that id.");
  return apiJson({ data: productJson(product) });
});
