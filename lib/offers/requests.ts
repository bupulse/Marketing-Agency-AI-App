import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { logError } from "@/lib/errors";
import { featureLabel } from "@/lib/features";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { sendRequestAlertEmail } from "./emails";
import { budgetLabel, isRequestStatus, readFeatureKeys, REQUEST_STATUSES, requestSchema, type RequestStatus } from "./shared";

// "Request a custom plan" (R5, docs/OFFERS.md): the client describes the business, its goals and the features it is
// interested in; the request is linked to the company and its demo booking, the owner is emailed, and the admin
// answers with an offer ("Customise plan", prefilled from the request). Rate-limited per company.

type Row = Prisma.CustomPlanRequestGetPayload<object>;

export class PlanRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanRequestError";
  }
}

/** Records a request from a signed-in company (any status, including one waiting for its demo). Throws RateLimitError. */
export async function createPlanRequest(input: { userId: string; actorId: string; businessId: string; raw: unknown }, now: Date = new Date()) {
  const parsed = requestSchema.safeParse(input.raw);
  if (!parsed.success) throw new PlanRequestError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  if (!input.businessId) throw new PlanRequestError("Your account is still being set up. Please try again in a moment.");
  await rateLimit(`plan-request:${input.businessId}`, RATE_LIMITS.planRequest, now);
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, name: true, ceoName: true, phone: true, user: { select: { email: true, name: true } } } });
  if (!business) throw new PlanRequestError("Your account is still being set up. Please try again in a moment.");
  const person = await prisma.user.findUnique({ where: { id: input.actorId }, select: { email: true, name: true } });
  const booking = await prisma.demoBooking.findFirst({ where: { businessId: business.id, status: "booked" }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true } });
  const d = parsed.data;
  const row = await prisma.customPlanRequest.create({
    data: {
      businessId: business.id,
      userId: input.actorId,
      demoBookingId: booking?.id ?? null,
      name: person?.name?.trim() || business.user?.name?.trim() || business.ceoName || "",
      email: person?.email ?? business.user?.email ?? "",
      phone: d.phone ?? business.phone ?? null,
      companyName: business.name,
      description: d.description,
      goals: d.goals,
      featureKeys: d.features as Prisma.InputJsonValue,
      budget: d.budget,
      source: d.source,
    },
  });
  try {
    await sendRequestAlertEmail({
      id: row.id,
      company: business.name,
      email: row.email,
      phone: row.phone,
      description: d.description,
      goals: d.goals,
      features: d.features.map(featureLabel),
      budget: budgetLabel(d.budget),
      demo: booking ? `Booked for ${booking.startsAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kigali" })} (Kigali)` : null,
    });
  } catch (error) {
    await logError(error, { source: "offers.request-alert", requestId: row.id });
  }
  return { id: row.id };
}

export type PlanRequestView = Omit<Row, "featureKeys"> & { features: ReturnType<typeof readFeatureKeys>; budgetLabel: string | null; status: RequestStatus };

const view = (r: Row): PlanRequestView => ({ ...r, features: readFeatureKeys(r.featureKeys), budgetLabel: budgetLabel(r.budget), status: isRequestStatus(r.status) ? r.status : "new" });

export async function listPlanRequests(opts: { status?: string; businessId?: string; limit?: number } = {}): Promise<PlanRequestView[]> {
  if (opts.status && !isRequestStatus(opts.status)) throw new AdminError("invalid", `status must be one of: ${REQUEST_STATUSES.join(", ")}.`);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 200);
  const rows = await prisma.customPlanRequest.findMany({ where: { ...(opts.status ? { status: opts.status } : {}), ...(opts.businessId ? { businessId: opts.businessId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit });
  return rows.map(view);
}

export async function getPlanRequest(id: string): Promise<PlanRequestView> {
  const row = await prisma.customPlanRequest.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No request with that id.");
  return view(row);
}

/** New requests waiting for the admin (sidebar badge). */
export async function newPlanRequestCount(): Promise<number> {
  return prisma.customPlanRequest.count({ where: { status: "new" } });
}

/** Contacted / closed (and back): the admin's own bookkeeping. Console only, audited. */
export async function setPlanRequestStatus(ctx: AdminContext, id: string, status: string) {
  if (ctx.viaApi) throw new AdminError("forbidden", "Requests are handled in the admin console.");
  if (!isRequestStatus(status)) throw new AdminError("invalid", `status must be one of: ${REQUEST_STATUSES.join(", ")}.`);
  const row = await prisma.customPlanRequest.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "No request with that id.");
  if (row.status === status) return { id, status };
  await prisma.$transaction(async (tx) => {
    await tx.customPlanRequest.update({ where: { id }, data: { status, handledBy: ctx.actor } });
    await writeAudit(tx, ctx, "set_request_status", `plan_request:${id}`, { status: row.status }, { status });
  });
  return { id, status };
}
