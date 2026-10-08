import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { contentJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// GET /api/v1/content/:id   (scope content:read)
export const GET = apiRoute("content:read", async (ctx, _request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  const content = await prisma.generatedContent.findFirst({ where: { id, project: { businessId: ctx.businessId } } });
  if (!content) return apiError(404, "not_found", "No content with that id.");
  return apiJson({ data: contentJson(content) });
});
