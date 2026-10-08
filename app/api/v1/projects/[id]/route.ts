import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { projectJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// GET /api/v1/projects/:id   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, _request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  const project = await prisma.project.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!project) return apiError(404, "not_found", "No project with that id.");
  return apiJson({ data: projectJson(project) });
});
