import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { parsePaging } from "@/lib/api/paging";
import { legacyProjectJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { PRODUCT_TYPES } from "@/lib/knowledge/legacy";

// DEPRECATED (docs/API.md): projects became products and campaigns, with the same ids. GET /api/v1/products and
// /api/v1/campaigns are the real lists. This keeps older scripts working in the old shape: products and campaigns
// together, newest first (createdAt, then id), cursor-paged like every other list; ?type= narrows it as before
// (product, listing, service, project: products of that kind; event, offer, other: campaigns of that type).
// GET /api/v1/projects?type=&limit=&cursor=   (scope projects:read)
export const GET = apiRoute("projects:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const type = params.get("type")?.trim().toLowerCase() || null;
  const include = { _count: { select: { photos: true } } };
  const businessId = ctx.businessId;

  // The cursor is the id of the last row of the previous page, a product's or a campaign's: rows strictly after it in
  // (createdAt desc, id desc) order come next.
  let after: { createdAt: Date; id: string } | null = null;
  if (paging.cursor) {
    const at =
      (await prisma.product.findFirst({ where: { id: paging.cursor, businessId }, select: { id: true, createdAt: true } })) ??
      (await prisma.campaign.findFirst({ where: { id: paging.cursor, businessId }, select: { id: true, createdAt: true } }));
    if (!at) return apiError(400, "invalid_request", "cursor is not valid.");
    after = at;
  }
  const older = after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {};
  const order = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const take = paging.limit + 1;

  const wantProducts = !type || type in PRODUCT_TYPES;
  const wantCampaigns = !type || !(type in PRODUCT_TYPES);
  const kind = type ? PRODUCT_TYPES[type] : undefined;
  const campaignType = type === "event" ? { type: "EVENT" as const } : type === "offer" ? { type: { in: ["OFFER" as const, "PROMOTION" as const] } } : type ? { type: "OTHER" as const } : {};
  const [products, campaigns] = await Promise.all([
    wantProducts ? prisma.product.findMany({ where: { businessId, ...(kind ? { kind } : {}), ...older }, include, orderBy: order, take }) : [],
    wantCampaigns ? prisma.campaign.findMany({ where: { businessId, ...campaignType, ...older }, include, orderBy: order, take }) : [],
  ]);
  const merged = [...products.map((product) => ({ at: product.createdAt, id: product.id, json: legacyProjectJson({ product }) })), ...campaigns.map((campaign) => ({ at: campaign.createdAt, id: campaign.id, json: legacyProjectJson({ campaign }) }))].sort(
    (a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  const page = merged.slice(0, paging.limit);
  return apiJson({ data: page.map((r) => r.json), nextCursor: merged.length > paging.limit ? page[page.length - 1].id : null });
});
