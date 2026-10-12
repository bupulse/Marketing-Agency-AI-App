import "server-only";
import { prisma } from "@/lib/db";
import { MANUAL_PAYMENT_EVENT } from "@/lib/analytics/math";
import { money } from "./format";
import { scrubSecrets } from "./scrub";

export { ACTIVITY_GROUPS, ACTIVITY_LABELS, type ActivityGroup, type ActivityItem, type ActivityPage } from "./activity-shared";
import { ACTIVITY_GROUPS, type ActivityGroup, type ActivityItem, type ActivityPage } from "./activity-shared";

// ---- cursor ------------------------------------------------------------------------------------------------

export const cursorOf = (item: Pick<ActivityItem, "at" | "id">) => `${Date.parse(item.at)}~${item.id}`;

export function parseCursor(cursor: string | null | undefined): { ms: number; id: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf("~");
  const ms = Number(cursor.slice(0, i));
  if (i < 1 || !Number.isFinite(ms) || cursor.length > 120) return null;
  return { ms, id: cursor.slice(i + 1) };
}

/** Newest first; equal times are ordered by id so paging never skips or repeats a row. */
export const compareItems = (a: Pick<ActivityItem, "at" | "id">, b: Pick<ActivityItem, "at" | "id">) => {
  const d = Date.parse(b.at) - Date.parse(a.at);
  return d !== 0 ? d : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/**
 * Pages a merged list. `before`: the next older page. `after` (polling): the OLDEST `limit` items newer than the
 * cursor, shown newest first, with `more` set when others wait, so a burst is read in order and nothing is skipped.
 * With no cursor it returns the newest items. `newest` is never null: an empty feed gets a cursor for "a few seconds
 * ago" so polling carries on.
 */
export function slice(all: ActivityItem[], opts: { before?: string | null; after?: string | null; limit: number; now?: number }): ActivityPage {
  const sorted = [...all].sort(compareItems);
  const before = parseCursor(opts.before);
  const after = parseCursor(opts.after);
  const key = (c: { ms: number; id: string }) => ({ at: new Date(c.ms).toISOString(), id: c.id });
  let list = sorted;
  if (before) list = list.filter((i) => compareItems(key(before), i) < 0);
  if (after) list = list.filter((i) => compareItems(i, key(after)) < 0);
  const more = !!after && list.length > opts.limit;
  const items = after ? list.slice(-opts.limit) : list.slice(0, opts.limit);
  // Rows can be stamped a little behind this server's clock, so the empty-feed cursor starts a few seconds back.
  const fallback = opts.after ?? `${(opts.now ?? Date.now()) - 10_000}~`;
  return {
    items,
    nextBefore: !after && list.length > opts.limit ? cursorOf(items[items.length - 1]) : null,
    newest: items.length ? cursorOf(items[0]) : fallback,
    more,
  };
}

// ---- sources -----------------------------------------------------------------------------------------------

const EVENT_MAP: Record<string, { group: ActivityGroup; title: string; tone: ActivityItem["tone"] }> = {
  signup: { group: "signup", title: "New sign-up", tone: "good" },
  onboarding_complete: { group: "onboarded", title: "Finished onboarding", tone: "good" },
  post_published: { group: "post", title: "Post published", tone: "neutral" },
  lead_captured: { group: "lead", title: "Lead captured", tone: "good" },
  upgrade: { group: "plan", title: "Started paying", tone: "good" },
  plan_change: { group: "plan", title: "Changed plan", tone: "neutral" },
  cancel: { group: "plan", title: "Cancelled", tone: "bad" },
};

const text = (v: unknown, max = 160) => (typeof v === "string" ? v.slice(0, max) : null);

type Raw = { at: Date; id: string; group: ActivityGroup; title: string; detail: string | null; tone: ActivityItem["tone"]; userId?: string | null; businessId?: string | null };

function paymentDetail(payload: unknown): string | null {
  const data = ((payload ?? {}) as { data?: Record<string, any> }).data ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  // A confirmed Mobile Money payment (lib/billing/momo.ts) carries its own amount and currency.
  if (typeof data.amount_minor === "number") return `${money(data.amount_minor, typeof data.currency === "string" ? data.currency : "RWF")} by Mobile Money`;
  const totals = data.details?.totals ?? data.totals;
  const raw = totals?.grand_total ?? totals?.total;
  const minor = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
  const currency = typeof (data.currency_code ?? totals?.currency_code) === "string" ? String(data.currency_code ?? totals?.currency_code) : "USD";
  return Number.isFinite(minor) ? money(minor, /^[A-Z]{3}$/.test(currency) ? currency : "USD") : null;
}

async function fromEvents(range: Range, take: number, groups: Set<ActivityGroup>, dir: Dir): Promise<Raw[]> {
  const names = Object.entries(EVENT_MAP).filter(([, v]) => groups.has(v.group)).map(([k]) => k);
  if (!names.length) return [];
  const rows = await prisma.analyticsEvent.findMany({ where: { name: { in: names }, createdAt: range }, orderBy: [{ createdAt: dir }, { id: dir }], take });
  return rows.map((r) => {
    const m = EVENT_MAP[r.name];
    const props = (r.props ?? {}) as Record<string, unknown>;
    const detail = r.name === "upgrade" || r.name === "plan_change" ? [text(props.plan, 20), text(props.interval, 20)].filter(Boolean).join(" ") || null : r.name === "post_published" ? text(props.network, 30) : r.name === "lead_captured" ? text(props.source, 30) : null;
    return { at: r.createdAt, id: `event:${r.id}`, group: m.group, title: m.title, detail, tone: m.tone, userId: r.userId, businessId: r.businessId };
  });
}

async function fromBilling(range: Range, take: number, groups: Set<ActivityGroup>, dir: Dir): Promise<Raw[]> {
  const types = [...(groups.has("payment") ? ["transaction.completed", MANUAL_PAYMENT_EVENT] : []), ...(groups.has("refund") ? ["adjustment.created", "adjustment.updated"] : [])];
  if (!types.length) return [];
  const rows = await prisma.billingEvent.findMany({ where: { type: { in: types }, createdAt: range }, orderBy: [{ createdAt: dir }, { id: dir }], take });
  const out: Raw[] = [];
  for (const r of rows) {
    if (r.type === "transaction.completed" || r.type === MANUAL_PAYMENT_EVENT) out.push({ at: r.createdAt, id: `billing:${r.id}`, group: "payment", title: r.type === MANUAL_PAYMENT_EVENT ? "Mobile Money payment confirmed" : "Payment received", detail: paymentDetail(r.payload), tone: "good", userId: r.userId });
    else {
      const d = ((r.payload ?? {}) as { data?: { action?: string; status?: string } }).data;
      if (d?.action === "refund" && d?.status === "approved") out.push({ at: r.createdAt, id: `billing:${r.id}`, group: "refund", title: "Refund issued", detail: paymentDetail(r.payload), tone: "bad", userId: r.userId });
    }
  }
  return out;
}

/** Mobile Money payments the client says they made, waiting for the owner to check (lib/billing/momo.ts). */
async function fromManualPayments(range: Range, take: number, groups: Set<ActivityGroup>, dir: Dir): Promise<Raw[]> {
  if (!groups.has("payment")) return [];
  const rows = await prisma.manualPayment.findMany({ where: { submittedAt: { not: null, ...range } }, orderBy: [{ submittedAt: dir }, { id: dir }], take, select: { id: true, submittedAt: true, reference: true, amountMinor: true, currency: true, status: true, userId: true } });
  return rows.map((r) => ({ at: r.submittedAt as Date, id: `momo:${r.id}`, group: "payment" as const, title: r.status === "pending" ? "MoMo payment to check" : `MoMo payment ${r.status}`, detail: `${money(r.amountMinor, r.currency)} · ${r.reference}`, tone: r.status === "rejected" ? ("bad" as const) : r.status === "pending" ? ("neutral" as const) : ("good" as const), userId: r.userId }));
}

async function fromErrors(range: Range, take: number, groups: Set<ActivityGroup>, dir: Dir): Promise<Raw[]> {
  if (!groups.has("error")) return [];
  const rows = await prisma.errorLog.findMany({ where: { level: "error", createdAt: range }, orderBy: [{ createdAt: dir }, { id: dir }], take, select: { id: true, createdAt: true, source: true, message: true, userId: true, businessId: true } });
  return rows.map((r) => ({ at: r.createdAt, id: `error:${r.id}`, group: "error" as const, title: `Error in ${r.source}`, detail: scrubSecrets(r.message, 160), tone: "bad" as const, userId: r.userId, businessId: r.businessId }));
}

async function fromAudit(range: Range, take: number, groups: Set<ActivityGroup>, dir: Dir): Promise<Raw[]> {
  if (!groups.has("admin")) return [];
  const rows = await prisma.auditLog.findMany({ where: { createdAt: range }, orderBy: [{ createdAt: dir }, { id: dir }], take, select: { id: true, createdAt: true, actor: true, action: true, target: true } });
  return rows.map((r) => ({
    at: r.createdAt,
    id: `audit:${r.id}`,
    group: "admin" as const,
    title: `${r.actor === "admin" ? "You" : "Jarvis"}: ${r.action.replace(/_/g, " ")}`,
    detail: r.target,
    tone: "neutral" as const,
    userId: r.target?.startsWith("user:") ? r.target.slice(5) : null,
  }));
}

type Range = { gte?: Date; lte?: Date };
type Dir = "asc" | "desc";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The activity feed, newest first, merged from product events, billing events, errors and the audit log.
 * `before` pages back through history; `after` returns only what is newer than a cursor (the 5-second poll).
 */
export async function getActivity(opts: { before?: string | null; after?: string | null; types?: string[]; limit?: number } = {}): Promise<ActivityPage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 40) || 40, 1), 100);
  const groups = new Set<ActivityGroup>((opts.types ?? []).filter((t): t is ActivityGroup => (ACTIVITY_GROUPS as readonly string[]).includes(t)));
  if (groups.size === 0) ACTIVITY_GROUPS.forEach((g) => groups.add(g));
  const before = parseCursor(opts.before);
  const after = parseCursor(opts.after);
  // Rows sharing the cursor's millisecond are fetched too and cut exactly by slice().
  const range: Range = { ...(before ? { lte: new Date(before.ms) } : {}), ...(after ? { gte: new Date(after.ms) } : {}) };
  const take = limit + 20;
  // Polling reads forward from the cursor (oldest first) so a burst bigger than one batch is taken in order.
  const dir: Dir = after ? "asc" : "desc";
  const raw = (await Promise.all([fromEvents(range, take, groups, dir), fromBilling(range, take, groups, dir), fromManualPayments(range, take, groups, dir), fromErrors(range, take, groups, dir), fromAudit(range, take, groups, dir)])).flat();

  const merged = raw.map<ActivityItem>((r) => ({ id: r.id, at: r.at.toISOString(), group: r.group, title: r.title, detail: r.detail, tone: r.tone, userId: r.userId && UUID.test(r.userId) ? r.userId : null, who: null, href: null, ...(r.businessId ? { _b: r.businessId } : {}) }) as ActivityItem & { _b?: string });
  const page = slice(merged, { before: opts.before, after: opts.after, limit });

  // Name the client on each row: the business name and owner email.
  const bizIds = [...new Set(page.items.map((i) => (i as ActivityItem & { _b?: string })._b).filter((b): b is string => !!b))];
  const userIds = [...new Set(page.items.map((i) => i.userId).filter((u): u is string => !!u))];
  const bizRows = bizIds.length ? await prisma.business.findMany({ where: { id: { in: bizIds } }, select: { id: true, name: true, userId: true } }) : [];
  const allUserIds = [...new Set([...userIds, ...bizRows.map((b) => b.userId)])];
  const userRows = allUserIds.length ? await prisma.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, email: true, business: { select: { name: true } } } }) : [];
  const biz = new Map(bizRows.map((b) => [b.id, b]));
  const users = new Map(userRows.map((u) => [u.id, u]));
  const items = page.items.map((i) => {
    const b = (i as ActivityItem & { _b?: string })._b;
    const userId = i.userId ?? (b ? biz.get(b)?.userId ?? null : null);
    const u = userId ? users.get(userId) : undefined;
    const name = u?.business?.name ?? (b ? biz.get(b)?.name : undefined);
    const clean: ActivityItem & { _b?: string } = { ...i, userId };
    delete clean._b;
    return { ...clean, who: [name, u?.email].filter(Boolean).join(" · ") || null, href: userId ? `/admin/users/${userId}` : null };
  });
  return { ...page, items };
}
