import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { productJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { ITEM_STATUSES, PRODUCT_KINDS } from "@/lib/knowledge/products";

// GET /api/v1/products?kind=physical|digital|service&status=active|draft|archived&limit=&cursor=   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const kind = params.get("kind")?.toUpperCase();
  const status = params.get("status")?.toUpperCase();
  if (kind && !(PRODUCT_KINDS as readonly string[]).includes(kind)) return apiError(400, "invalid_request", "kind must be physical, digital or service.");
  if (status && !(ITEM_STATUSES as readonly string[]).includes(status)) return apiError(400, "invalid_request", "status must be active, draft or archived.");
  const rows = await prisma.product.findMany({
    where: { businessId: ctx.businessId, ...(kind ? { kind: kind as (typeof PRODUCT_KINDS)[number] } : {}), ...(status ? { status: status as (typeof ITEM_STATUSES)[number] } : {}) },
    include: { _count: { select: { photos: true } } },
    ...pageArgs(paging),
  });
  const page = toPage(rows, paging.limit);
  return apiJson({ data: page.data.map(productJson), nextCursor: page.nextCursor });
});
