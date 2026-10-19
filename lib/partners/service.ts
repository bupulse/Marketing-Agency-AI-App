import "server-only";
// The partner programme (docs/bizdev/PLAN.md section 6, docs/guide/features/21-partner-programme.md): applications from
// /partners, approval and payouts in Admin -> Sales -> Partners, the referral at sign-up and the partner's own page.
// Nothing here sends a message to anyone outside BuPulse: the owner sends the partner its link.
import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { getSetting } from "@/lib/admin/settings";
import { MONEY_EVENT_TYPES } from "@/lib/analytics/math";
import { dedupe, toRevenueEntry, type RevenueEntry } from "@/lib/money/revenue-shared";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { toE164 } from "@/lib/phone";
import { publicLimited } from "@/lib/request-limits";
import { REF_ALPHABET, normalizeRef } from "@/lib/staff/permissions";
import { partnerCommission, type CommissionSummary } from "./commission";
import { PARTNER_CODE_LENGTH, PAYOUT_REFERENCE, normalizePayoutReference, partnerApplicationSchema, type PartnerFields, type PartnerFormState, type PartnerKind, type PartnerStatus } from "./shared";

const isUniqueError = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

// ---- the application (public) ---------------------------------------------------------------------------------------

const FIELDS: PartnerFields[] = ["kind", "name", "organisation", "email", "phone", "city", "message", "agree"];

/** Validates and stores an application. Returns the state the form renders. Never emails anyone. */
export async function submitPartnerApplication(formData: FormData): Promise<PartnerFormState> {
  const raw = Object.fromEntries(FIELDS.map((k) => [k, String(formData.get(k) ?? "")])) as Record<PartnerFields, string>;
  // Honeypot: real people never see or fill this field. Pretend it worked.
  if (String(formData.get("website") ?? "").trim() !== "") return { status: "success" };

  const limited = await publicLimited("partnerApply", raw.email || null);
  if (limited) return { status: "error", errors: { form: limited }, values: raw };

  const parsed = partnerApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: NonNullable<PartnerFormState["errors"]> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0]) as PartnerFields] ??= issue.message;
    return { status: "error", errors, values: raw };
  }
  const d = parsed.data;
  try {
    // One open application or partnership per address: a second one is accepted silently (no way to probe who applied).
    const open = await prisma.partner.findFirst({ where: { email: d.email, status: { in: ["applied", "approved", "paused"] } }, select: { id: true } });
    if (!open) {
      await prisma.partner.create({
        data: { kind: d.kind, name: d.name, organisation: d.organisation ?? null, email: d.email, phone: toE164(d.phone, "RW") ?? d.phone, city: d.city ?? null, message: d.message ?? null },
      });
    }
  } catch (error) {
    console.error("partner application failed", error);
    return { status: "error", errors: { form: "Something went wrong on our side. Please try again, or email hello@bupulse.com." }, values: raw };
  }
  return { status: "success" };
}

// ---- the referral at sign-up ----------------------------------------------------------------------------------------

/**
 * Records the company as referred by the partner whose code the visitor came with, when that partner is approved.
 * Never throws: a sign-up must not fail because of a referral. Staff codes (lib/sales/referral.ts) are not partners'
 * codes, so for a staff link this finds nothing. Returns the partner's id, or null.
 */
export async function assignPartnerReferral(input: { businessId: string; userId: string; email?: string | null; code: string | null | undefined; at?: Date }): Promise<string | null> {
  const code = normalizeRef(input.code);
  if (!code || code.length !== PARTNER_CODE_LENGTH) return null;
  try {
    const partner = await prisma.partner.findUnique({ where: { refCode: code }, select: { id: true, status: true, email: true } });
    if (!partner || partner.status !== "approved") return null;
    // No self-referral: a partner signing up their own company does not earn on it.
    if (input.email && partner.email === input.email.trim().toLowerCase()) return null;
    await prisma.partnerReferral.create({ data: { partnerId: partner.id, businessId: input.businessId, userId: input.userId, code, ...(input.at ? { createdAt: input.at } : {}) } });
    return partner.id;
  } catch {
    return null; // already referred (unique on the company), or the database blinked
  }
}

// ---- admin actions (console only, audited) --------------------------------------------------------------------------

function requireConsole(ctx: AdminContext) {
  if (ctx.viaApi) throw new AdminError("forbidden", "Partners are managed in the admin console.");
}

function randomCode(): string {
  return Array.from({ length: PARTNER_CODE_LENGTH }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join("");
}

/** The partner's link on a page of the site (default the home page). */
export function partnerLink(code: string, path = "/"): string {
  const url = new URL(path, publicSiteUrl());
  url.searchParams.set("ref", code);
  return url.toString();
}

/** The partner's private page with its numbers. */
export const partnerPageUrl = (token: string) => `${publicSiteUrl()}/partners/me/${token}`;

/** Approves an application (or a rejected one): a unique 7-character code and a private page token. */
export async function approvePartner(ctx: AdminContext, id: string, now = new Date()) {
  requireConsole(ctx);
  const before = await prisma.partner.findUnique({ where: { id } });
  if (!before) throw new AdminError("not_found", "No partner with that id.");
  if (before.status === "approved") throw new AdminError("conflict", "This partner is already active.");
  if (before.status === "paused") throw new AdminError("conflict", "This partner is paused: resume it instead.");
  for (let i = 0; i < 8; i++) {
    const refCode = before.refCode ?? randomCode();
    const viewToken = before.viewToken ?? randomBytes(32).toString("base64url");
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const { count } = await tx.partner.updateMany({ where: { id, status: before.status }, data: { status: "approved", refCode, viewToken, rejectReason: null, decidedBy: ctx.actor, decidedAt: now } });
        if (count !== 1) throw new AdminError("conflict", "This partner changed meanwhile. Reload the page.");
        await writeAudit(tx, ctx, "approve_partner", `partner:${id}`, { status: before.status }, { status: "approved", refCode });
        return { refCode, viewToken };
      });
      return { id, ...updated, link: partnerLink(updated.refCode), page: partnerPageUrl(updated.viewToken) };
    } catch (e) {
      if (!isUniqueError(e)) throw e; // a code collision: try another one
    }
  }
  throw new AdminError("unavailable", "Could not make a unique partner code. Try again.");
}

export async function rejectPartner(ctx: AdminContext, id: string, reason: string, now = new Date()) {
  requireConsole(ctx);
  const why = reason.trim();
  if (why.length < 3 || why.length > 300) throw new AdminError("invalid", "Give a short reason (3 to 300 characters). Only the admin sees it.");
  const before = await prisma.partner.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw new AdminError("not_found", "No partner with that id.");
  if (before.status !== "applied") throw new AdminError("conflict", "Only a new application can be turned down. Pause an active partner instead.");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.partner.updateMany({ where: { id, status: "applied" }, data: { status: "rejected", rejectReason: why, decidedBy: ctx.actor, decidedAt: now } });
    if (count !== 1) throw new AdminError("conflict", "This application changed meanwhile. Reload the page.");
    await writeAudit(tx, ctx, "reject_partner", `partner:${id}`, { status: "applied" }, { status: "rejected", reason: why });
  });
  return { id, status: "rejected" as const };
}

/** Pause: the link stops counting new sign-ups; commission on companies already referred keeps counting. Resume undoes it. */
export async function setPartnerPaused(ctx: AdminContext, id: string, paused: boolean) {
  requireConsole(ctx);
  const from: PartnerStatus = paused ? "approved" : "paused";
  const to: PartnerStatus = paused ? "paused" : "approved";
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.partner.updateMany({ where: { id, status: from }, data: { status: to } });
    if (count !== 1) throw new AdminError("conflict", paused ? "Only an active partner can be paused." : "Only a paused partner can be resumed.");
    await writeAudit(tx, ctx, paused ? "pause_partner" : "resume_partner", `partner:${id}`, { status: from }, { status: to });
  });
  return { id, status: to };
}

/**
 * "Mark as paid": records a commission payout made by hand with Mobile Money. The amount must be whole francs, at most
 * what is owed now; the MoMo reference is unique (the same payout cannot be recorded twice).
 */
export async function recordPartnerPayout(ctx: AdminContext, input: { partnerId: string; amountRwf: number; reference: string; note?: string | null }, now = new Date()) {
  requireConsole(ctx);
  const reference = normalizePayoutReference(input.reference);
  if (!PAYOUT_REFERENCE.test(reference)) throw new AdminError("invalid", "Type the Mobile Money transaction id of the payout (letters and digits).");
  if (!Number.isInteger(input.amountRwf) || input.amountRwf <= 0) throw new AdminError("invalid", "Type the amount paid, in whole francs.");
  const note = input.note?.trim() || null;
  if (note && note.length > 300) throw new AdminError("invalid", "Keep the note under 300 characters.");
  const partner = await prisma.partner.findUnique({ where: { id: input.partnerId }, select: { id: true, status: true } });
  if (!partner) throw new AdminError("not_found", "No partner with that id.");
  const summary = (await partnerSummaries([partner.id], now)).get(partner.id);
  const owed = summary?.owedRwf ?? 0;
  if (input.amountRwf > owed) throw new AdminError("invalid", `That is more than is owed now (${owed.toLocaleString("en-US")} RWF, payments of the last 14 days are still on hold).`);
  try {
    const payout = await prisma.$transaction(async (tx) => {
      const row = await tx.partnerPayout.create({ data: { partnerId: partner.id, amountMinor: input.amountRwf, currency: "RWF", reference, note, paidAt: now, createdBy: ctx.actor } });
      await writeAudit(tx, ctx, "partner_payout", `partner:${partner.id}`, { owedRwf: owed }, { payoutId: row.id, amountRwf: input.amountRwf, reference, note });
      return row;
    });
    return { id: payout.id, amountRwf: payout.amountMinor, reference, owedAfterRwf: owed - payout.amountMinor };
  } catch (e) {
    if (isUniqueError(e)) throw new AdminError("conflict", "A payout with that Mobile Money reference is already recorded.");
    throw e;
  }
}

// ---- numbers ---------------------------------------------------------------------------------------------------------

/** Every payment and refund of these account users (all time), as the books count them. */
export async function entriesForUsers(userIds: readonly string[]): Promise<RevenueEntry[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.billingEvent.findMany({
    where: { userId: { in: [...userIds] }, type: { in: MONEY_EVENT_TYPES } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { eventId: true, type: true, payload: true, createdAt: true, userId: true },
  });
  return dedupe(rows.map(toRevenueEntry).filter((e): e is RevenueEntry => !!e));
}

/** The commission summary of each partner. */
export async function partnerSummaries(partnerIds: readonly string[], now = new Date()): Promise<Map<string, CommissionSummary>> {
  const ids = [...partnerIds];
  if (ids.length === 0) return new Map();
  const [referrals, payouts, usdToRwf] = await Promise.all([
    prisma.partnerReferral.findMany({ where: { partnerId: { in: ids } }, select: { id: true, partnerId: true, businessId: true, userId: true, createdAt: true } }),
    prisma.partnerPayout.groupBy({ by: ["partnerId"], where: { partnerId: { in: ids } }, _sum: { amountMinor: true } }),
    getSetting("usdToRwf"),
  ]);
  const entries = await entriesForUsers([...new Set(referrals.map((r) => r.userId))]);
  const paid = new Map(payouts.map((p) => [p.partnerId, p._sum.amountMinor ?? 0]));
  return new Map(ids.map((id) => [id, partnerCommission({ referrals: referrals.filter((r) => r.partnerId === id), entries, paidRwf: paid.get(id) ?? 0, usdToRwf, now })]));
}

export type ReferredCompany = { businessId: string; name: string; plan: string | null; signedUpAt: Date; firstPaidAt: Date | null; qualified: boolean; earnUntil: Date | null; earnedRwf: number };
export type PartnerRow = {
  id: string;
  status: PartnerStatus;
  kind: PartnerKind;
  name: string;
  organisation: string | null;
  email: string;
  phone: string;
  city: string | null;
  message: string | null;
  refCode: string | null;
  link: string | null;
  page: string | null;
  rejectReason: string | null;
  createdAt: Date;
  summary: CommissionSummary | null;
  companies: ReferredCompany[];
  payouts: { id: string; amountRwf: number; reference: string; note: string | null; paidAt: Date }[];
};

async function companiesOf(referrals: { id: string; businessId: string; createdAt: Date }[], summary: CommissionSummary | null): Promise<ReferredCompany[]> {
  if (referrals.length === 0) return [];
  const businesses = await prisma.business.findMany({ where: { id: { in: referrals.map((r) => r.businessId) } }, select: { id: true, name: true, user: { select: { subscription: { select: { plan: true, status: true } } } } } });
  const byId = new Map(businesses.map((b) => [b.id, b]));
  const status = new Map((summary?.referrals ?? []).map((s) => [s.referralId, s]));
  return referrals
    .map((r) => {
      const b = byId.get(r.businessId);
      const s = status.get(r.id);
      return { businessId: r.businessId, name: b?.name ?? "Deleted company", plan: b?.user.subscription?.status === "ACTIVE" ? b.user.subscription.plan : null, signedUpAt: r.createdAt, firstPaidAt: s?.firstPaidAt ?? null, qualified: s?.qualified ?? false, earnUntil: s?.earnUntil ?? null, earnedRwf: s?.earnedRwf ?? 0 };
    })
    .sort((a, b) => b.signedUpAt.getTime() - a.signedUpAt.getTime());
}

/** Admin -> Sales -> Partners: every partner and application, newest first, with its numbers. */
export async function loadPartners(now = new Date()): Promise<PartnerRow[]> {
  const partners = await prisma.partner.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: { referrals: { select: { id: true, businessId: true, createdAt: true } }, payouts: { orderBy: { paidAt: "desc" }, select: { id: true, amountMinor: true, reference: true, note: true, paidAt: true } } },
  });
  const summaries = await partnerSummaries(partners.filter((p) => p.refCode).map((p) => p.id), now);
  return Promise.all(
    partners.map(async (p) => {
      const summary = summaries.get(p.id) ?? null;
      return {
        id: p.id,
        status: p.status as PartnerStatus,
        kind: p.kind as PartnerKind,
        name: p.name,
        organisation: p.organisation,
        email: p.email,
        phone: p.phone,
        city: p.city,
        message: p.message,
        refCode: p.refCode,
        link: p.refCode ? partnerLink(p.refCode) : null,
        page: p.viewToken ? partnerPageUrl(p.viewToken) : null,
        rejectReason: p.rejectReason,
        createdAt: p.createdAt,
        summary,
        companies: await companiesOf(p.referrals, summary),
        payouts: p.payouts.map((x) => ({ id: x.id, amountRwf: x.amountMinor, reference: x.reference, note: x.note, paidAt: x.paidAt })),
      };
    }),
  );
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type PartnerView = { name: string; status: PartnerStatus; link: string | null; summary: CommissionSummary; companies: ReferredCompany[]; payouts: PartnerRow["payouts"] };

/** The partner's own page (/partners/me/<token>), or null for an unknown token or a partner that is not active or paused. */
export async function partnerByToken(token: string, now = new Date()): Promise<PartnerView | null> {
  if (!TOKEN.test(token)) return null;
  const p = await prisma.partner.findUnique({
    where: { viewToken: token },
    include: { referrals: { select: { id: true, businessId: true, createdAt: true } }, payouts: { orderBy: { paidAt: "desc" }, select: { id: true, amountMinor: true, reference: true, note: true, paidAt: true } } },
  });
  if (!p || (p.status !== "approved" && p.status !== "paused")) return null;
  const summary = (await partnerSummaries([p.id], now)).get(p.id)!;
  return {
    name: p.organisation || p.name,
    status: p.status as PartnerStatus,
    link: p.status === "approved" && p.refCode ? partnerLink(p.refCode) : null,
    summary,
    companies: await companiesOf(p.referrals, summary),
    payouts: p.payouts.map((x) => ({ id: x.id, amountRwf: x.amountMinor, reference: x.reference, note: x.note, paidAt: x.paidAt })),
  };
}

/** New applications waiting for the admin (the sidebar badge could read this). */
export const pendingPartnerApplications = () => prisma.partner.count({ where: { status: "applied" } });
