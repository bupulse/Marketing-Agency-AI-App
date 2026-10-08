/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

// A tiny in-memory stand-in for Prisma: just the calls lib/admin and lib/usage make. Equality filters plus
// not/lt/lte/gt/gte, unique-key checks that raise P2002 like the real database.

export type Row = Record<string, any>;
type Where = Record<string, any> | undefined;

function match(row: Row, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Where[]).some((w) => match(row, w));
    if (key === "month_category") return row.month === cond.month && row.category === cond.category;
    if (key === "AND") return (cond as Where[]).every((w) => match(row, w));
    const value = row[key] === undefined ? null : row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Record<string, any>;
      if ("not" in c && value === c.not) return false;
      if ("lt" in c && !(value < c.lt)) return false;
      if ("lte" in c && !(value <= c.lte)) return false;
      if ("gt" in c && !(value > c.gt)) return false;
      if ("gte" in c && !(value >= c.gte)) return false;
      if ("has" in c && !(value ?? []).includes(c.has)) return false;
      return true;
    }
    return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond;
  });
}

function table(rows: Row[], opts: { pk: string; unique?: string[]; defaults?: () => Row }) {
  const uniqueKeys = [opts.pk, ...(opts.unique ?? [])];
  let seq = 0;
  const copy = (r: Row | undefined | null) => (r ? { ...r } : null);
  const find = (where: Record<string, any>) => rows.find((r) => match(r, where)) ?? null;
  const api = {
    rows,
    findUnique: vi.fn(async ({ where }: { where: Record<string, any> }) => copy(find(where))),
    findFirst: vi.fn(async ({ where }: { where?: Where } = {}) => copy(rows.find((r) => match(r, where)))),
    findMany: vi.fn(async ({ where, take }: { where?: Where; take?: number } = {}) => rows.filter((r) => match(r, where)).slice(0, take).map((r) => ({ ...r }))),
    count: vi.fn(async ({ where }: { where?: Where } = {}) => rows.filter((r) => match(r, where)).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      for (const k of uniqueKeys) {
        if (data[k] !== undefined && rows.some((r) => r[k] === data[k])) throw Object.assign(new Error(`Unique constraint failed on ${k}`), { code: "P2002" });
      }
      const row: Row = { ...(opts.defaults?.() ?? {}), createdAt: new Date(), ...data };
      if (row[opts.pk] === undefined) row[opts.pk] = `${opts.pk}_${++seq}`;
      rows.push(row);
      return row;
    }),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      for (const d of data) if (!rows.some((r) => r.userId === d.userId && r.periodStart?.getTime() === d.periodStart?.getTime())) rows.push({ textGenerations: 0, imageGenerations: 0, videoSeconds: 0, voiceCharacters: 0, chatMessages: 0, ...d });
      return { count: data.length };
    }),
    updateMany: vi.fn(async ({ where, data }: { where?: Where; data: Row }) => {
      const hit = rows.filter((r) => match(r, where));
      for (const r of hit) for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in v ? (r[k] ?? 0) + v.increment : v;
      return { count: hit.length };
    }),
    update: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Row }) => {
      const row = find(where);
      if (!row) throw new Error("Record not found");
      Object.assign(row, data);
      return row;
    }),
    upsert: vi.fn(async ({ where, create, update }: { where: Record<string, any>; create: Row; update: Row }) => {
      const row = find(where);
      if (row) return Object.assign(row, update);
      return api.create({ data: create });
    }),
    deleteMany: vi.fn(async ({ where }: { where?: Where } = {}) => {
      const keep = rows.filter((r) => !match(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
    groupBy: vi.fn(async () => []),
  };
  return api;
}

export function createFakeDb() {
  const db = {
    user: table([], { pk: "id", unique: ["email"] }),
    subscription: table([], { pk: "id", unique: ["userId"] }),
    business: table([], { pk: "id" }),
    post: table([], { pk: "id" }),
    lead: table([], { pk: "id" }),
    errorLog: table([], { pk: "id" }),
    usageRecord: table([], { pk: "id" }),
    auditLog: table([], { pk: "id" }),
    adminApproval: table([], { pk: "id", unique: ["idempotencyKey"], defaults: () => ({ status: "pending", result: null, decidedBy: null, decidedAt: null }) }),
    adminApiKey: table([], { pk: "id", unique: ["hash"] }),
    featureFlag: table([], { pk: "key" }),
    announcement: table([], { pk: "id" }),
    monthlyCost: table([], { pk: "id" }),
    planLimitOverride: table([], { pk: "plan" }),
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return db;
}
export type FakeDb = ReturnType<typeof createFakeDb>;
