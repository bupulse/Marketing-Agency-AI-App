import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { withdrawAllOffers } from "@/lib/creators/offers";
import { writeAudit } from "./audit";
import { AdminError, type AdminContext, type Page } from "./types";

// The creator marketplace in the admin console (docs/CREATOR_MARKETPLACE.md, "Safety"): campaigns on /creators (hide
// and unhide), creator profiles (block and unblock: blocking withdraws their open offers) and the reports companies and
// creators send (resolve with a note, or hide or block straight from one). Every change is one transaction with its
// audit row (before and after), like lib/admin/actions/connections.ts. Callers check the admin first (`adminAction()`).

const DAY_MS = 86_400_000;

function limitOf(value: number | undefined, def = 25) {
  return Math.min(Math.max(Math.trunc(value ?? def) || def, 1), 100);
}

function page<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return { items, nextCursor: more ? items[items.length - 1].id : null };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new AdminError("invalid", `${field} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

const textOf = (q: string | undefined) => q?.trim().slice(0, 100) || undefined;

/** A reason or note: required ones need 3 characters; at most 300 are kept. Saved in the audit log. */
function reasonOf(value: string | undefined, required: boolean, what: string): string | null {
  const reason = value?.trim().slice(0, 300) || null;
  if (required && (!reason || reason.length < 3)) throw new AdminError("invalid", `Give a reason for ${what}, in a few words. It is saved in the audit log.`);
  return reason;
}

// ---- reads --------------------------------------------------------------------------------------------------------

export const CAMPAIGN_STATES = ["listed", "unlisted", "hidden"] as const;
export const CREATOR_STATES = ["findable", "blocked"] as const;
export const REPORT_STATUSES = ["OPEN", "RESOLVED"] as const;

/** Creator campaigns, newest first: search by campaign name, link or company; filter listed, unlisted, hidden. */
export async function listMarketplaceCampaigns(opts: { q?: string; state?: string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const state = oneOf(opts.state, CAMPAIGN_STATES, "state");
  const q = textOf(opts.q);
  const where: Prisma.CreatorCampaignWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q.toLowerCase() } }, { business: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    ...(state === "hidden" ? { hiddenAt: { not: null } } : state === "listed" ? { listed: true, hiddenAt: null } : state === "unlisted" ? { listed: false, hiddenAt: null } : {}),
  };
  const rows = await prisma.creatorCampaign.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: { id: true, name: true, slug: true, status: true, listed: true, hiddenAt: true, hiddenReason: true, acceptingApplications: true, startsOn: true, endsOn: true, createdAt: true, business: { select: { id: true, name: true, userId: true } }, _count: { select: { reports: { where: { status: "OPEN" } } } } },
  });
  const p = page(rows, limit);
  const joined = p.items.length ? await prisma.campaignCreator.groupBy({ by: ["campaignId"], where: { campaignId: { in: p.items.map((c) => c.id) }, status: "JOINED" }, _count: { _all: true } }) : [];
  return {
    items: p.items.map((c) => ({ ...c, openReports: c._count.reports, joined: joined.find((j) => j.campaignId === c.id)?._count._all ?? 0 })),
    nextCursor: p.nextCursor,
  };
}

/** Creator profiles, newest first: search by name, email, WhatsApp or location; filter findable or blocked. */
export async function listMarketplaceCreators(opts: { q?: string; state?: string; cursor?: string; limit?: number; now?: Date } = {}) {
  const limit = limitOf(opts.limit);
  const state = oneOf(opts.state, CREATOR_STATES, "state");
  const q = textOf(opts.q);
  const now = opts.now ?? new Date();
  const where: Prisma.CreatorProfileWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }, { phone: { contains: q.replace(/\s/g, "") } }, { location: { contains: q, mode: "insensitive" } }] } : {}),
    ...(state === "blocked" ? { blockedAt: { not: null } } : state === "findable" ? { discoverable: true, blockedAt: null } : {}),
  };
  const rows = await prisma.creatorProfile.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: { id: true, name: true, phone: true, location: true, discoverable: true, blockedAt: true, blockedReason: true, createdAt: true, userId: true, user: { select: { email: true } }, _count: { select: { reports: { where: { status: "OPEN" } } } } },
  });
  const p = page(rows, limit);
  const ids = p.items.map((r) => r.id);
  const stands = ids.length ? await prisma.campaignCreator.findMany({ where: { profileId: { in: ids }, status: { in: ["JOINED", "OFFERED"] } }, select: { profileId: true, status: true, offeredAt: true } }) : [];
  const since = new Date(now.getTime() - 14 * DAY_MS);
  return {
    items: p.items.map((r) => ({
      ...r,
      email: r.user.email,
      openReports: r._count.reports,
      joined: stands.filter((s) => s.profileId === r.id && s.status === "JOINED").length,
      openOffers: stands.filter((s) => s.profileId === r.id && s.status === "OFFERED" && s.offeredAt && s.offeredAt > since).length,
    })),
    nextCursor: p.nextCursor,
  };
}

/** Reports, oldest open first (the queue), or newest resolved first. With what each one is about and who sent it. */
export async function listCreatorReports(opts: { status?: string; cursor?: string; limit?: number } = {}) {
  const limit = limitOf(opts.limit);
  const status = oneOf(opts.status, REPORT_STATUSES, "status") ?? "OPEN";
  const rows = await prisma.creatorReport.findMany({
    where: { status },
    orderBy: status === "OPEN" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ resolvedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, kind: true, reason: true, details: true, status: true, createdAt: true, resolvedAt: true, resolvedBy: true, resolution: true, reporterUserId: true, businessId: true,
      campaign: { select: { id: true, name: true, slug: true, hiddenAt: true, business: { select: { id: true, name: true } } } },
      profile: { select: { id: true, name: true, blockedAt: true } },
    },
  });
  const p = page(rows, limit);
  const [users, businesses] = await Promise.all([
    p.items.length ? prisma.user.findMany({ where: { id: { in: [...new Set(p.items.map((r) => r.reporterUserId))] } }, select: { id: true, email: true } }) : [],
    p.items.some((r) => r.businessId) ? prisma.business.findMany({ where: { id: { in: [...new Set(p.items.flatMap((r) => (r.businessId ? [r.businessId] : [])))] } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    items: p.items.map((r) => ({
      ...r,
      reporterEmail: users.find((u) => u.id === r.reporterUserId)?.email ?? null,
      reporterBusiness: r.businessId ? (businesses.find((b) => b.id === r.businessId)?.name ?? null) : null,
    })),
    nextCursor: p.nextCursor,
  };
}
export type CreatorReportRow = Awaited<ReturnType<typeof listCreatorReports>>["items"][number];

/** Open reports, for Admin → Inbox. */
export const openReportCount = () => prisma.creatorReport.count({ where: { status: "OPEN" } });

// ---- actions -------------------------------------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Resolves an OPEN report about this target inside the same transaction (a hide or block made from the report). */
async function resolveWith(tx: Tx, ctx: AdminContext, reportId: string | undefined, target: { campaignId?: string; profileId?: string }, note: string) {
  if (!reportId) return;
  const r = await tx.creatorReport.findUnique({ where: { id: reportId }, select: { id: true, campaignId: true, profileId: true } });
  if (!r || (target.campaignId && r.campaignId !== target.campaignId) || (target.profileId && r.profileId !== target.profileId)) throw new AdminError("not_found", "That report is not about this campaign or creator.");
  const at = new Date();
  // Already resolved (by someone else just now): the hide or block still stands, and that report keeps its own note.
  const { count } = await tx.creatorReport.updateMany({ where: { id: r.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: at, resolvedBy: ctx.actor, resolution: note } });
  if (count === 1) await writeAudit(tx, ctx, "creators_resolve_report", `creator_report:${r.id}`, { status: "OPEN" }, { status: "RESOLVED", resolvedAt: at, resolution: note });
}

/**
 * Hides a campaign from the marketplace, whatever the company's own switch says. Its /c/<slug> page keeps working for
 * creators already in it. A reason is required: the company sees it in the campaign's Settings.
 */
export async function hideCampaign(ctx: AdminContext, input: { campaignId: string; reason: string; reportId?: string }) {
  const reason = reasonOf(input.reason, true, "hiding a campaign")!;
  const c = await prisma.creatorCampaign.findUnique({ where: { id: input.campaignId }, select: { id: true, name: true, status: true, listed: true, hiddenAt: true, businessId: true } });
  if (!c) throw new AdminError("not_found", "No creator campaign with that id.");
  if (c.hiddenAt) throw new AdminError("conflict", "That campaign is already hidden.");
  const at = new Date();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.creatorCampaign.updateMany({ where: { id: c.id, hiddenAt: null }, data: { hiddenAt: at, hiddenReason: reason } });
    if (count !== 1) throw new AdminError("conflict", "That campaign was just changed. Reload and try again.");
    await writeAudit(tx, ctx, "creators_hide_campaign", `creator_campaign:${c.id}`, { name: c.name, status: c.status, listed: c.listed, hiddenAt: null, businessId: c.businessId }, { hiddenAt: at, reason, reportId: input.reportId ?? null });
    await resolveWith(tx, ctx, input.reportId, { campaignId: c.id }, `Campaign hidden: ${reason}`);
    return { campaignId: c.id, hiddenAt: at };
  });
}

/** Shows a hidden campaign again (the company's own switch applies again). */
export async function unhideCampaign(ctx: AdminContext, input: { campaignId: string; reason?: string }) {
  const reason = reasonOf(input.reason, false, "showing a campaign again");
  const c = await prisma.creatorCampaign.findUnique({ where: { id: input.campaignId }, select: { id: true, name: true, listed: true, hiddenAt: true, hiddenReason: true, businessId: true } });
  if (!c) throw new AdminError("not_found", "No creator campaign with that id.");
  if (!c.hiddenAt) throw new AdminError("conflict", "That campaign is not hidden.");
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.creatorCampaign.updateMany({ where: { id: c.id, hiddenAt: { not: null } }, data: { hiddenAt: null, hiddenReason: null } });
    if (count !== 1) throw new AdminError("conflict", "That campaign was just changed. Reload and try again.");
    await writeAudit(tx, ctx, "creators_unhide_campaign", `creator_campaign:${c.id}`, { name: c.name, hiddenAt: c.hiddenAt, hiddenReason: c.hiddenReason, businessId: c.businessId }, { hiddenAt: null, listed: c.listed, reason });
    return { campaignId: c.id };
  });
}

/**
 * Blocks a creator from the marketplace: they cannot apply, companies cannot find or invite them, and their open
 * offers are withdrawn (DECLINED). Campaigns they already joined go on unless a company removes them. A reason is
 * required.
 */
export async function blockCreator(ctx: AdminContext, input: { profileId: string; reason: string; reportId?: string }) {
  const reason = reasonOf(input.reason, true, "blocking a creator")!;
  const p = await prisma.creatorProfile.findUnique({ where: { id: input.profileId }, select: { id: true, name: true, discoverable: true, blockedAt: true, userId: true } });
  if (!p) throw new AdminError("not_found", "No creator profile with that id.");
  if (p.blockedAt) throw new AdminError("conflict", "That creator is already blocked.");
  const at = new Date();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.creatorProfile.updateMany({ where: { id: p.id, blockedAt: null }, data: { blockedAt: at, blockedReason: reason } });
    if (count !== 1) throw new AdminError("conflict", "That creator was just changed. Reload and try again.");
    const offersWithdrawn = await withdrawAllOffers(tx, p.id);
    await writeAudit(tx, ctx, "creators_block_creator", `creator_profile:${p.id}`, { name: p.name, discoverable: p.discoverable, blockedAt: null, userId: p.userId }, { blockedAt: at, reason, offersWithdrawn, reportId: input.reportId ?? null });
    await resolveWith(tx, ctx, input.reportId, { profileId: p.id }, `Creator blocked: ${reason}`);
    return { profileId: p.id, blockedAt: at, offersWithdrawn };
  });
}

/** Lifts a block. Withdrawn offers stay withdrawn; companies can invite them again. */
export async function unblockCreator(ctx: AdminContext, input: { profileId: string; reason?: string }) {
  const reason = reasonOf(input.reason, false, "unblocking a creator");
  const p = await prisma.creatorProfile.findUnique({ where: { id: input.profileId }, select: { id: true, name: true, blockedAt: true, blockedReason: true, userId: true } });
  if (!p) throw new AdminError("not_found", "No creator profile with that id.");
  if (!p.blockedAt) throw new AdminError("conflict", "That creator is not blocked.");
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.creatorProfile.updateMany({ where: { id: p.id, blockedAt: { not: null } }, data: { blockedAt: null, blockedReason: null } });
    if (count !== 1) throw new AdminError("conflict", "That creator was just changed. Reload and try again.");
    await writeAudit(tx, ctx, "creators_unblock_creator", `creator_profile:${p.id}`, { name: p.name, blockedAt: p.blockedAt, blockedReason: p.blockedReason, userId: p.userId }, { blockedAt: null, reason });
    return { profileId: p.id };
  });
}

/** Closes a report with the admin's note (what was looked at, what was done). */
export async function resolveReport(ctx: AdminContext, input: { reportId: string; note: string }) {
  const note = reasonOf(input.note, true, "closing a report")!;
  const r = await prisma.creatorReport.findUnique({ where: { id: input.reportId }, select: { id: true, status: true, kind: true, reason: true, campaignId: true, profileId: true } });
  if (!r) throw new AdminError("not_found", "No report with that id.");
  if (r.status !== "OPEN") throw new AdminError("conflict", "That report is already resolved.");
  const at = new Date();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.creatorReport.updateMany({ where: { id: r.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: at, resolvedBy: ctx.actor, resolution: note } });
    if (count !== 1) throw new AdminError("conflict", "That report was just resolved by someone else.");
    await writeAudit(tx, ctx, "creators_resolve_report", `creator_report:${r.id}`, { status: "OPEN", kind: r.kind, reason: r.reason, campaignId: r.campaignId, profileId: r.profileId }, { status: "RESOLVED", resolvedAt: at, resolution: note });
    return { reportId: r.id, resolvedAt: at };
  });
}
