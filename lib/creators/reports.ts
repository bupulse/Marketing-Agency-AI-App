import "server-only";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// Marketplace reports (docs/CREATOR_MARKETPLACE.md, "Safety"): a creator reports a campaign, a company reports a
// creator. Shared by the creator portal and the company dashboard; the admin console lists and resolves them.

export const CAMPAIGN_REPORT_REASONS = ["SCAM", "NOT_PAID", "SPAM", "OFFENSIVE", "OTHER"] as const;
export const CREATOR_REPORT_REASONS = ["FAKE_VIEWS", "SPAM", "OFFENSIVE", "OTHER"] as const;
export type ReportReason = (typeof CAMPAIGN_REPORT_REASONS)[number] | (typeof CREATOR_REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  SCAM: "It looks like a scam",
  NOT_PAID: "They did not pay what they owe",
  FAKE_VIEWS: "Fake or bought views",
  SPAM: "Spam",
  OFFENSIVE: "Offensive content",
  OTHER: "Something else",
};

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
