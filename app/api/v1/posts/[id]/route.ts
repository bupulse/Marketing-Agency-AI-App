import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { postJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";

// GET /api/v1/posts/:id   (scope posts:read)
export const GET = apiRoute("posts:read", async (ctx, _request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  const post = await prisma.post.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!post) return apiError(404, "not_found", "No post with that id.");
  return apiJson({ data: postJson(post) });
});
