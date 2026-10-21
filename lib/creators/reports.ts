import "server-only";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { CAMPAIGN_REPORT_REASONS, CREATOR_REPORT_REASONS } from "./report-reasons";

// Marketplace reports (docs/CREATOR_MARKETPLACE.md, "Safety"): a creator reports a campaign, a company reports a
// creator. Shared by the creator portal and the company dashboard; the admin console lists and resolves them.

// The reasons and their words live in ./report-reasons (no server imports), so the report forms can use them too.
export { CAMPAIGN_REPORT_REASONS, CREATOR_REPORT_REASONS, REPORT_REASON_LABEL, type ReportReason } from "./report-reasons";

export class ReportError extends Error {}

export type NewReport =
  | { kind: "CAMPAIGN"; campaignId: string; reporterUserId: string; reason: string; details?: string | null }
  | { kind: "CREATOR"; profileId: string; reporterUserId: string; businessId: string; reason: string; details?: string | null };

/** Files a report. One OPEN report per reporter and target: a second one updates the first. */
export async function createReport(input: NewReport): Promise<{ id: string }> {
  const reasons: readonly string[] = input.kind === "CAMPAIGN" ? CAMPAIGN_REPORT_REASONS : CREATOR_REPORT_REASONS;
  if (!reasons.includes(input.reason)) throw new ReportError("Choose a reason.");
  const details = input.details?.trim().slice(0, 2000) || null;
  if (input.reason === "OTHER" && !details) throw new ReportError("Tell us what happened.");
  await rateLimit(`creator-report:${input.reporterUserId}`, { limit: 10, windowSeconds: 24 * 60 * 60 });

  const target = input.kind === "CAMPAIGN" ? { campaignId: input.campaignId } : { profileId: input.profileId };
  if (input.kind === "CAMPAIGN" && !(await prisma.creatorCampaign.findUnique({ where: { id: input.campaignId }, select: { id: true } }))) throw new ReportError("That campaign no longer exists.");
  if (input.kind === "CREATOR" && !(await prisma.creatorProfile.findUnique({ where: { id: input.profileId }, select: { id: true } }))) throw new ReportError("That creator no longer exists.");

  const open = await prisma.creatorReport.findFirst({ where: { kind: input.kind, reporterUserId: input.reporterUserId, status: "OPEN", ...target }, select: { id: true } });
  if (open) {
    await prisma.creatorReport.update({ where: { id: open.id }, data: { reason: input.reason, details } });
    return open;
  }
  return prisma.creatorReport.create({
    data: { kind: input.kind, ...target, reporterUserId: input.reporterUserId, businessId: input.kind === "CREATOR" ? input.businessId : null, reason: input.reason, details },
    select: { id: true },
  });
}
