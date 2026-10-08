import { z } from "zod";
import { apiError, apiJson, apiRoute } from "@/lib/api/auth";
import { leadJson } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { LEAD_STATUSES } from "@/lib/leads/filters";
import { cleanText } from "@/lib/leads/normalize";

// GET /api/v1/leads/:id   (scope leads:read)
export const GET = apiRoute("leads:read", async (ctx, _request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  const lead = await prisma.lead.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!lead) return apiError(404, "not_found", "No lead with that id.");
  return apiJson({ data: leadJson(lead) });
});

const patchSchema = z
  .object({
    status: z.string().transform((s) => s.toUpperCase()).pipe(z.enum(LEAD_STATUSES)).optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.notes !== undefined, "Send status, notes or both.");

// PATCH /api/v1/leads/:id  { status?, notes? }   (scope leads:write)
export const PATCH = apiRoute("leads:write", async (ctx, request, route: { params: Promise<{ id: string }> }) => {
  const { id } = await route.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "status must be new, contacted, won or lost, and notes must be text.");
  const { status, notes } = parsed.data;
  const result = await prisma.lead.updateMany({
    where: { id, businessId: ctx.businessId },
    data: { ...(status ? { status } : {}), ...(notes !== undefined ? { notes: notes === null ? null : (cleanText(notes, 5000) ?? null) } : {}) },
  });
  if (result.count !== 1) return apiError(404, "not_found", "No lead with that id.");
  const lead = await prisma.lead.findFirst({ where: { id, businessId: ctx.businessId } });
  return apiJson({ data: lead ? leadJson(lead) : null });
});
