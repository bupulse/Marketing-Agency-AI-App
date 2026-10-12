import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { legacyProjectJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { PRODUCT_TYPES } from "@/lib/knowledge/legacy";

// DEPRECATED (docs/API.md): projects became products and campaigns, with the same ids. GET /api/v1/products and
// /api/v1/campaigns are the real lists. This keeps older scripts working in the old shape: products, or campaigns
// when ?type= is a campaign type (event, offer, other).
// GET /api/v1/projects?type=&limit=&cursor=   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const type = params.get("type")?.trim().toLowerCase() || null;
  const include = { _count: { select: { photos: true } } };
  if (type && !(type in PRODUCT_TYPES)) {
    const where = { businessId: ctx.businessId, ...(type === "event" ? { type: "EVENT" as const } : type === "offer" ? { type: { in: ["OFFER" as const, "PROMOTION" as const] } } : {}) };
    const rows = await prisma.campaign.findMany({ where, include, ...pageArgs(paging) });
    const page = toPage(rows, paging.limit);
    return apiJson({ data: page.data.map((campaign) => legacyProjectJson({ campaign })), nextCursor: page.nextCursor });
  }
  const kind = type ? PRODUCT_TYPES[type] : undefined;
  const rows = await prisma.product.findMany({ where: { businessId: ctx.businessId, ...(kind ? { kind } : {}) }, include, ...pageArgs(paging) });
  const page = toPage(rows, paging.limit);
  return apiJson({ data: page.data.map((product) => legacyProjectJson({ product })), nextCursor: page.nextCursor });
});
