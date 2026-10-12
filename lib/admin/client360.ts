import "server-only";
import { prisma } from "@/lib/db";
import { getPriceTable } from "@/lib/plan-catalog";
import { computeMrrCents, MANUAL_PAYMENT_EVENT, MONEY_EVENT_TYPES } from "@/lib/analytics/math";
import { getPlanLimits, USAGE_METRICS } from "./plan-limits";
import { getClientConnections } from "./connections";
import { scrubSecrets } from "./scrub";
import { AdminError } from "./types";

export const CLIENT_TABS = ["overview", "billing", "usage", "channels", "content", "leads", "errors", "audit", "notes"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

const METRIC_LABELS: Record<string, string> = { text: "Text generations", image: "Images", videoSeconds: "Video seconds", voiceCharacters: "Voice characters", chat: "Chat replies" };
const PAYING = new Set(["ACTIVE", "PAST_DUE"]);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const DAY = 86_400_000;

/**
 * The client the rest of this file is about. Every other query is scoped by this user's id or this business id,
 * never by an id that came from the page, so one client's page cannot show another client's rows.
 */
async function loadClient(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, createdAt: true, suspendedAt: true, suspendedReason: true, deletionScheduledFor: true,
      subscription: { select: { plan: true, status: true, provider: true, interval: true, trialEndsAt: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } },
      business: { select: { id: true, name: true, industry: true, industryOther: true, industryDescription: true, country: true, phone: true, ceoName: true, website: true, onboardedAt: true, createdAt: true } },
    },
  });
  if (!user) throw new AdminError("not_found", "No user with that id.");
  return user;
}
type Client = Awaited<ReturnType<typeof loadClient>>;

export async function overviewSection(c: Client) {
  const [signup, lastEvent, lastAi] = await Promise.all([
    prisma.analyticsEvent.findFirst({ where: { name: "signup", userId: c.id }, orderBy: { createdAt: "asc" }, select: { sessionId: true } }),
    prisma.analyticsEvent.findFirst({ where: { userId: c.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.aiCall.findFirst({ where: { userId: c.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const visit = signup?.sessionId
    ? await prisma.pageView.findFirst({ where: { sessionId: signup.sessionId }, orderBy: { createdAt: "asc" }, select: { source: true, path: true, utmCampaign: true, country: true } })
    : null;
  const sub = c.subscription;
  const mrrCents = sub && PAYING.has(sub.status) ? computeMrrCents([{ plan: sub.plan, interval: sub.interval, count: 1 }], await getPriceTable()) : 0;
  const times = [lastEvent?.createdAt, lastAi?.createdAt].filter((d): d is Date => !!d);
  return {
    user: { id: c.id, email: c.email, name: c.name, createdAt: iso(c.createdAt), suspendedAt: iso(c.suspendedAt), suspendedReason: c.suspendedReason, deletionScheduledFor: iso(c.deletionScheduledFor) },
    subscription: sub ? { ...sub, trialEndsAt: iso(sub.trialEndsAt), currentPeriodEnd: iso(sub.currentPeriodEnd) } : null,
    business: c.business ? { id: c.business.id, name: c.business.name, industry: c.business.industry, industryDescription: c.business.industryDescription, country: c.business.country, phone: c.business.phone, ceoName: c.business.ceoName, website: c.business.website, onboarded: !!c.business.onboardedAt } : null,
    mrrCents,
    signupSource: visit ? { source: visit.source, landingPage: visit.path, campaign: visit.utmCampaign, country: visit.country } : null,
    lastActiveAt: times.length ? new Date(Math.max(...times.map((t) => t.getTime()))).toISOString() : null,
  };
}

export async function billingSection(c: Client) {
  const rows = await prisma.billingEvent.findMany({
    where: { userId: c.id, type: { in: MONEY_EVENT_TYPES } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, type: true, payload: true, createdAt: true },
  });
  const items = rows.flatMap((r): { kind: "payment" | "refund"; id: string; at: string; providerId: string | null; amountMinor: number | null; currency: string }[] => {
    const data = ((r.payload ?? {}) as { data?: Record<string, any> }).data ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    // A confirmed Mobile Money payment carries its own amount (RWF) and our reference as the id.
    if (r.type === MANUAL_PAYMENT_EVENT) return [{ kind: "payment" as const, id: r.id, at: r.createdAt.toISOString(), providerId: typeof data.id === "string" ? data.id : null, amountMinor: typeof data.amount_minor === "number" ? data.amount_minor : null, currency: typeof data.currency === "string" ? data.currency : "RWF" }];
    const totals = data.details?.totals ?? data.totals;
    const minor = Number(totals?.grand_total ?? totals?.total);
    const base = { id: r.id, at: r.createdAt.toISOString(), providerId: typeof data.id === "string" ? data.id : null, amountMinor: Number.isFinite(minor) ? minor : null, currency: typeof (data.currency_code ?? totals?.currency_code) === "string" ? String(data.currency_code ?? totals?.currency_code) : "USD" };
    if (r.type === "transaction.completed") return [{ ...base, kind: "payment" as const }];
    if (data.action === "refund" && data.status === "approved") return [{ ...base, kind: "refund" as const }];
    return [];
  });
  return { items, provider: c.subscription?.provider ?? null };
}

export async function usageSection(c: Client, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const [usage, ai, limits] = await Promise.all([
    prisma.usageRecord.findFirst({ where: { userId: c.id }, orderBy: { periodStart: "desc" } }),
    prisma.aiCall.aggregate({ where: { userId: c.id, createdAt: { gte: since } }, _sum: { costUsd: true }, _count: { _all: true } }),
    c.subscription ? getPlanLimits(c.subscription.plan) : null,
  ]);
  const used: Record<string, number> = usage ? { text: usage.textGenerations, image: usage.imageGenerations, videoSeconds: usage.videoSeconds, voiceCharacters: usage.voiceCharacters, chat: usage.chatMessages } : {};
  const failures = await prisma.aiCall.count({ where: { userId: c.id, createdAt: { gte: since }, success: false } });
  return {
    periodStart: iso(usage?.periodStart),
    metrics: USAGE_METRICS.map((k) => ({ key: k, label: METRIC_LABELS[k] ?? k, used: used[k] ?? 0, limit: limits ? limits[k] : null })),
    ai: { calls30d: ai._count._all, failures30d: failures, costUsd30d: Number(ai._sum.costUsd ?? 0) },
  };
}

export async function channelsSection(c: Client) {
  const bid = c.business?.id;
  if (!bid) return { businessId: null, connectors: null, connections: [], counts: { webhooks: 0, apiKeys: 0 }, widget: null };
  const [connections, webhooks, apiKeys, widget] = await Promise.all([
    prisma.connection.findMany({ where: { businessId: bid }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, provider: true, displayName: true, status: true, postingMode: true, expiresAt: true, lastError: true, lastCheckedAt: true } }),
    prisma.webhookEndpoint.count({ where: { businessId: bid } }),
    prisma.apiKey.count({ where: { businessId: bid, revokedAt: null } }),
    prisma.chatWidget.findUnique({ where: { businessId: bid }, select: { enabled: true, lastSeenAt: true, lastSeenHost: true, disabledByAdminAt: true } }),
  ]);
  // Stores, Cloudflare and imported files come from the Connections pages' own read function.
  const connectors = await getClientConnections(bid).then((r) => ({ stores: r.stores, cloudflare: r.cloudflare, importedFiles: r.importedFiles })).catch(() => null);
  return {
    businessId: bid,
    connectors,
    connections: connections.map((x) => ({ ...x, lastError: x.lastError ? scrubSecrets(x.lastError, 200) : null, expiresAt: iso(x.expiresAt), lastCheckedAt: iso(x.lastCheckedAt) })),
    counts: { webhooks, apiKeys },
    widget: widget ? { enabled: widget.enabled, lastSeenAt: iso(widget.lastSeenAt), lastSeenHost: widget.lastSeenHost, disabledByAdmin: !!widget.disabledByAdminAt } : null,
  };
}

export async function contentSection(c: Client) {
  const bid = c.business?.id;
  if (!bid) return { counts: {}, posts: [] };
  const [counts, posts] = await Promise.all([
    prisma.post.groupBy({ by: ["status"], where: { businessId: bid }, _count: { _all: true } }),
    prisma.post.findMany({
      where: { businessId: bid },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, network: true, status: true, format: true, text: true, scheduledAt: true, publishedAt: true, permalink: true, lastError: true, createdAt: true, metrics: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true, reach: true, likes: true, comments: true, shares: true } } },
    }),
  ]);
  return {
    counts: Object.fromEntries(counts.map((x) => [x.status, x._count._all])),
    posts: posts.map((p) => ({ id: p.id, network: p.network, status: p.status, format: p.format, text: p.text.slice(0, 200), at: iso(p.publishedAt ?? p.scheduledAt ?? p.createdAt), permalink: p.permalink, lastError: p.lastError ? scrubSecrets(p.lastError, 200) : null, metrics: p.metrics[0] ?? null })),
  };
}

export async function leadsSection(c: Client) {
  const bid = c.business?.id;
  if (!bid) return { total: 0, byStatus: {}, leads: [], chat: { sessions30d: 0 } };
  const [total, byStatus, leads, sessions] = await Promise.all([
    prisma.lead.count({ where: { businessId: bid } }),
    prisma.lead.groupBy({ by: ["status"], where: { businessId: bid }, _count: { _all: true } }),
    prisma.lead.findMany({ where: { businessId: bid }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, email: true, source: true, status: true, interest: true, createdAt: true } }),
    prisma.chatSession.count({ where: { businessId: bid, createdAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
  ]);
  return { total, byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])), leads: leads.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })), chat: { sessions30d: sessions } };
}

export async function errorsSection(c: Client) {
  const or: { userId?: string; businessId?: string }[] = [{ userId: c.id }];
  if (c.business?.id) or.push({ businessId: c.business.id });
  const rows = await prisma.errorLog.findMany({ where: { OR: or }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, createdAt: true, level: true, source: true, message: true } });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), message: scrubSecrets(r.message, 300) }));
}

export async function auditSection(c: Client) {
  const bid = c.business?.id;
  // Everything done to this client's own things: the account, the business, and its channels, connectors, webhooks, keys and widget.
  const targets = [`user:${c.id}`];
  if (bid) {
    const [connections, webhooks, keys, stores, cloudflare, canva] = await Promise.all([
      prisma.connection.findMany({ where: { businessId: bid }, select: { id: true } }),
      prisma.webhookEndpoint.findMany({ where: { businessId: bid }, select: { id: true } }),
      prisma.apiKey.findMany({ where: { businessId: bid }, select: { id: true } }),
      prisma.storeConnection.findMany({ where: { businessId: bid }, select: { id: true } }),
      prisma.cloudflareConnection.findUnique({ where: { businessId: bid }, select: { businessId: true } }),
      prisma.canvaConnection.findUnique({ where: { userId: c.id }, select: { id: true } }),
    ]);
    targets.push(
      `business:${bid}`,
      `widget:${bid}`,
      ...connections.map((x) => `connection:${x.id}`),
      ...webhooks.map((x) => `webhook:${x.id}`),
      ...keys.map((x) => `api_key:${x.id}`),
      ...stores.map((x) => `store:${x.id}`),
      ...(cloudflare ? [`cloudflare:${cloudflare.businessId}`] : []),
      ...(canva ? [`canva:${canva.id}`] : []),
    );
  }
  const rows = await prisma.auditLog.findMany({ where: { target: { in: targets } }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, actor: true, action: true, target: true, before: true, after: true, createdAt: true } });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function notesSection(c: Client) {
  const rows = await prisma.adminNote.findMany({ where: { userId: c.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((n) => ({ id: n.id, body: n.body, createdBy: n.createdBy, createdAt: n.createdAt.toISOString() }));
}

export async function loadSection(tab: ClientTab, c: Client) {
  switch (tab) {
    case "overview": return overviewSection(c);
    case "billing": return billingSection(c);
    case "usage": return usageSection(c);
    case "channels": return channelsSection(c);
    case "content": return contentSection(c);
    case "leads": return leadsSection(c);
    case "errors": return errorsSection(c);
    case "audit": return auditSection(c);
    case "notes": return notesSection(c);
  }
}

export { loadClient };

/** Everything about one client in one object (plain JSON), for the MCP tool and the Users page. */
export async function getClient360(userId: string) {
  const c = await loadClient(userId);
  const [overview, billing, usage, channels, content, leads, errors, audit, notes] = await Promise.all([
    overviewSection(c), billingSection(c), usageSection(c), channelsSection(c), contentSection(c), leadsSection(c), errorsSection(c), auditSection(c), notesSection(c),
  ]);
  return { overview, billing, usage, channels, content, leads, errors, audit, notes };
}
