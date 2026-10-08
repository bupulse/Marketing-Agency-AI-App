import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { leadJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { isLeadStatus, leadWhere } from "@/lib/leads/filters";

// GET /api/v1/leads?status=&source=&q=&since=&limit=&cursor=   (scope leads:read)
export const GET = apiRoute("leads:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const status = params.get("status")?.toUpperCase();
  if (status && !isLeadStatus(status)) return apiError(400, "invalid_request", "status must be new, contacted, won or lost.");
  const source = params.get("source")?.trim();
  const q = params.get("q")?.trim().slice(0, 100);
  const sinceRaw = params.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return apiError(400, "invalid_request", "since must be a date, for example 2026-10-01T00:00:00Z.");
  const where = { ...leadWhere(ctx.businessId, { ...(status && isLeadStatus(status) ? { status } : {}), ...(source && /^[a-z_]{1,40}$/.test(source) ? { source } : {}), ...(q ? { q } : {}) }), ...(since ? { createdAt: { gte: since } } : {}) };
  const rows = await prisma.lead.findMany({ where, ...pageArgs(paging) });
  const page = toPage(rows, paging.limit);
  return apiJson({ data: page.data.map(leadJson), nextCursor: page.nextCursor });
});
