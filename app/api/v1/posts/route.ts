import { z } from "zod";
import { apiError, apiFeatureDenied, apiJson, apiRoute } from "@/lib/api/auth";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { postJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { hashtagList, optionalLink, TEXT_MAX } from "@/lib/publishing/schemas";
import { isNetwork } from "@/lib/social/registry";

const STATUSES = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "PUBLISHED", "NEEDS_ACTION", "FAILED", "CANCELLED"] as const;

// GET /api/v1/posts?status=&network=&projectId=&limit=&cursor=   (scope posts:read)
export const GET = apiRoute("posts:read", async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const paging = parsePaging(params);
  if ("error" in paging) return apiError(400, "invalid_request", paging.error);
  const status = params.get("status")?.toUpperCase();
  if (status && !(STATUSES as readonly string[]).includes(status)) return apiError(400, "invalid_request", `status must be one of: ${STATUSES.map((s) => s.toLowerCase()).join(", ")}.`);
  const network = params.get("network");
  const projectId = params.get("projectId");
  const rows = await prisma.post.findMany({
    where: { businessId: ctx.businessId, ...(status ? { status: status as (typeof STATUSES)[number] } : {}), ...(network ? { network } : {}), ...(projectId ? { projectId } : {}) },
    ...pageArgs(paging),
  });
  const page = toPage(rows, paging.limit);
  return apiJson({ data: page.data.map(postJson), nextCursor: page.nextCursor });
});

// The same rules as a draft saved in the composer (lib/publishing/schemas.ts): hashtags are cleaned the same way,
// the link must be http(s), the text is capped at TEXT_MAX, and a draft needs some text (the API has no photos).
const createSchema = z.object({
  network: z.string().refine(isNetwork, "network must be instagram, facebook, linkedin, tiktok or youtube."),
  text: z.string().max(TEXT_MAX, "That is too long.").refine((t) => t.trim().length > 0, "text is required."),
  hashtags: hashtagList.optional(),
  link: optionalLink,
  projectId: z.string().max(60).optional(),
});

// POST /api/v1/posts  { network, text, hashtags?, link?, projectId? }   (scope posts:write)
// Creates a DRAFT only. Scheduling and publishing stay in the BuPulse calendar, where the owner checks the post, so
// creating one needs the calendar feature in the plan.
export const POST = apiRoute("posts:write", async (ctx, request) => {
  const denied = await apiFeatureDenied(ctx.businessId, "calendar");
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "The request body is not valid.");
  const { projectId, ...fields } = parsed.data;
  if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, businessId: ctx.businessId }, select: { id: true } }))) {
    return apiError(404, "not_found", "No project with that id.");
  }
  const post = await prisma.post.create({
    data: { businessId: ctx.businessId, status: "DRAFT", source: "MANUAL", network: fields.network, text: fields.text.trim(), hashtags: fields.hashtags ?? [], link: fields.link, projectId: projectId ?? null },
  });
  return apiJson({ data: postJson(post) }, 201);
});
