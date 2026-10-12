import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.API_KEY_PEPPER = "test-pepper-for-api-keys";
});

// ---- A tiny in-memory database: just enough to prove who can see what ------------------------------------
type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({ lead: [] as Row[], project: [] as Row[], product: [] as Row[], campaign: [] as Row[], generatedContent: [] as Row[], post: [] as Row[], apiKey: [] as Row[], business: [] as Row[] }));

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "project") return matches((db.project.find((p) => p.id === row.projectId) ?? { id: "" }) as Row, cond as Record<string, unknown>);
    if (key === "OR") return (cond as Record<string, unknown>[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { gte?: Date; lt?: Date | string; in?: unknown[] };
      if (c.gte) return (value as Date) >= c.gte;
      if (c.lt !== undefined) return c.lt instanceof Date ? (value as Date) < c.lt : (value as string) < c.lt;
      if (c.in) return c.in.includes(value);
      if (cond instanceof Object && !Array.isArray(cond)) return true;
    }
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    return value === cond;
  });
}
function table(name: "lead" | "project" | "product" | "campaign" | "generatedContent" | "post") {
  return {
    findMany: vi.fn(async (args: { where?: Record<string, unknown>; take?: number; cursor?: { id: string }; skip?: number }) => {
      let rows = db[name].filter((r) => matches(r, args.where)).sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || (a.id < b.id ? 1 : -1));
      if (args.cursor) rows = rows.slice(rows.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0));
      return rows.slice(0, args.take);
    }),
    findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => db[name].find((r) => matches(r, args.where)) ?? null),
    updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = db[name].filter((r) => matches(r, args.where));
      hit.forEach((r) => Object.assign(r, args.data));
      return { count: hit.length };
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `new${db[name].length}`, createdAt: new Date(), updatedAt: new Date(), format: "POST", mediaPaths: [], contentId: null, title: null, scheduledAt: null, publishedAt: null, permalink: null, lastError: null, ...data } as Row;
      db[name].push(row);
      return row;
    }),
  };
}
const prisma = vi.hoisted(() => ({}) as Record<string, unknown>);
Object.assign(prisma, {
  lead: table("lead"),
  project: table("project"),
  product: table("product"),
  campaign: table("campaign"),
  generatedContent: table("generatedContent"),
  post: table("post"),
  apiKey: {
    findUnique: vi.fn(async ({ where }: { where: { hash: string } }) => db.apiKey.find((k) => k.hash === where.hash) ?? null),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  business: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.business.find((b) => b.id === where.id) ?? null),
  },
});
vi.mock("@/lib/db", () => ({ prisma }));

// One custom plan beyond the seeds: API access without website chat or the calendar, to prove the write gates.
vi.mock("@/lib/plan-catalog", async (orig) => {
  const actual = await orig<typeof import("@/lib/plan-catalog")>();
  return { ...actual, getPlan: async (key: string) => (key === "API_ONLY" ? { ...(await actual.getPlan("PRO"))!, key: "API_ONLY", features: ["apiAccess"] } : actual.getPlan(key)) };
});

const rateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit }));

import { apiFeatureDenied, authenticate, API_RATE_LIMIT } from "@/lib/api/auth";
import { generateApiKey, hashApiKey, legacyHashApiKey, validateKeyInput, ApiKeyError } from "@/lib/api/keys";
import { pageArgs, parsePaging, toPage } from "@/lib/api/paging";
import { RateLimitError } from "@/lib/rate-limit";
import { GET as listLeads } from "@/app/api/v1/leads/route";
import { GET as getLead, PATCH as patchLead } from "@/app/api/v1/leads/[id]/route";
import { GET as listProjects } from "@/app/api/v1/projects/route";
import { GET as listProducts } from "@/app/api/v1/products/route";
import { GET as getProduct } from "@/app/api/v1/products/[id]/route";
import { GET as listCampaigns } from "@/app/api/v1/campaigns/route";
import { GET as getCampaign } from "@/app/api/v1/campaigns/[id]/route";
import { GET as getProject } from "@/app/api/v1/projects/[id]/route";
import { GET as listContent } from "@/app/api/v1/content/route";
import { GET as getContent } from "@/app/api/v1/content/[id]/route";
import { GET as listPosts, POST as createPost } from "@/app/api/v1/posts/route";
import { GET as getPost } from "@/app/api/v1/posts/[id]/route";

const KEY_A = "bp_live_keyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY_B = "bp_live_keyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const KEY_READONLY = "bp_live_keyRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR";
const ALL = ["projects:read", "content:read", "posts:read", "posts:write", "leads:read", "leads:write"];
const req = (key: string | null, url = "https://x.test/api/v1/leads", init: RequestInit = {}) => new Request(url, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers as object) } });
const ctxId = (id: string) => ({ params: Promise.resolve({ id }) });
const day = (n: number) => new Date(Date.UTC(2026, 9, n));

beforeEach(async () => {
  rateLimit.mockReset().mockResolvedValue(undefined);
  for (const rows of Object.values(db)) rows.length = 0;
  const proSub = { subscription: { plan: "PRO", status: "ACTIVE" } };
  db.business.push({ id: "bizA", user: proSub }, { id: "bizB", user: proSub }, { id: "bizFree", user: { subscription: { plan: "STANDARD", status: "ACTIVE" } } });
  db.apiKey.push(
    { id: "kA", businessId: "bizA", scopes: ALL, hash: await hashApiKey(KEY_A), revokedAt: null, lastUsedAt: null },
    { id: "kB", businessId: "bizB", scopes: ALL, hash: await hashApiKey(KEY_B), revokedAt: null, lastUsedAt: null },
    { id: "kR", businessId: "bizA", scopes: ["leads:read"], hash: await hashApiKey(KEY_READONLY), revokedAt: null, lastUsedAt: null },
  );
  const lead = (id: string, businessId: string, d: number, status = "NEW") => ({ id, businessId, name: `Lead ${id}`, email: `${id}@x.com`, phone: null, interest: null, message: null, source: "website_chat", status, notes: null, pageUrl: null, createdAt: day(d), updatedAt: day(d) });
  db.lead.push(lead("a1", "bizA", 1), lead("a2", "bizA", 2, "WON"), lead("a3", "bizA", 3), lead("b1", "bizB", 4));
  db.project.push({ id: "pA", businessId: "bizA", type: "product", title: "A thing", price: null, features: [], photoPaths: ["secret/path.jpg"], createdAt: day(1), updatedAt: day(1) }, { id: "pB", businessId: "bizB", type: "product", title: "B thing", price: null, features: [], photoPaths: [], createdAt: day(1), updatedAt: day(1) });
  // The migration copied each project into a product with the same id (lib/knowledge/legacy.ts).
  const product = (id: string, businessId: string, photos: number) => ({ id, businessId, kind: "PHYSICAL", name: `${id} thing`, category: null, summary: "A thing", description: null, priceModel: "FIXED", priceAmount: 15000, currency: "RWF", priceNote: null, usps: ["Local"], features: [], targetCustomer: null, status: "ACTIVE", details: null, _count: { photos }, createdAt: day(1), updatedAt: day(1) });
  db.product.push(product("pA", "bizA", 1), product("pB", "bizB", 0));
  db.campaign.push({ id: "kgA", businessId: "bizA", type: "EVENT", name: "Open day", description: null, startsAt: day(20), endsAt: null, priceInfo: "Free entry", highlights: [], status: "ACTIVE", products: [{ productId: "pA" }], _count: { photos: 0 }, createdAt: day(2), updatedAt: day(2) }, { id: "kgB", businessId: "bizB", type: "OFFER", name: "B sale", description: null, startsAt: null, endsAt: null, priceInfo: null, highlights: [], status: "ACTIVE", products: [], _count: { photos: 0 }, createdAt: day(2), updatedAt: day(2) });
  db.generatedContent.push({ id: "cA", businessId: "bizA", productId: "pA", campaignId: null, projectId: "pA", caption: "A", hashtags: [], videoScript: "", adHeadlines: [], language: "English", edited: false, createdAt: day(1) }, { id: "cB", businessId: "bizB", productId: "pB", campaignId: null, projectId: "pB", caption: "B", hashtags: [], videoScript: "", adHeadlines: [], language: "English", edited: false, createdAt: day(1) });
  db.post.push({ id: "postA", businessId: "bizA", network: "instagram", status: "DRAFT", format: "POST", projectId: "pA", productId: "pA", campaignId: null, contentId: null, title: null, text: "hi", hashtags: [], link: null, mediaPaths: [], scheduledAt: null, publishedAt: null, permalink: null, lastError: null, createdAt: day(1) }, { id: "postB", businessId: "bizB", network: "instagram", status: "DRAFT", format: "POST", projectId: "pB", productId: "pB", campaignId: null, contentId: null, title: null, text: "other", hashtags: [], link: null, mediaPaths: [], scheduledAt: null, publishedAt: null, permalink: null, lastError: null, createdAt: day(1) });
});

describe("API keys", () => {
  it("makes bp_live_ keys with a recognisable prefix, and hashes them with HMAC-SHA256 and the server pepper", async () => {
    const { key, prefix } = generateApiKey();
    expect(key).toMatch(/^bp_live_[A-Za-z0-9_-]{43}$/);
    expect(prefix).toBe(key.slice(0, 12));
    expect(generateApiKey().key).not.toBe(key);
    const { createHash, createHmac } = await import("node:crypto");
    expect(await hashApiKey(key)).toBe(createHmac("sha256", "test-pepper-for-api-keys").update(key).digest("hex"));
    expect(await hashApiKey(key)).not.toBe(createHash("sha256").update(key).digest("hex"));
    expect(await legacyHashApiKey(key)).toBe(createHash("sha256").update(key).digest("hex"));
  });
  it("without API_KEY_PEPPER, peppers with a key derived from ENCRYPTION_KEY (not the raw key), and fails closed with neither", async () => {
    const { createHmac } = await import("node:crypto");
    const saved = { pepper: process.env.API_KEY_PEPPER, enc: process.env.ENCRYPTION_KEY };
    try {
      delete process.env.API_KEY_PEPPER;
      process.env.ENCRYPTION_KEY = "enc-key-for-tests";
      const derived = await hashApiKey(KEY_A);
      expect(derived).toMatch(/^[0-9a-f]{64}$/);
      expect(derived).not.toBe(createHmac("sha256", "enc-key-for-tests").update(KEY_A).digest("hex"));
      expect(derived).not.toBe(await legacyHashApiKey(KEY_A));
      delete process.env.ENCRYPTION_KEY;
      await expect(hashApiKey(KEY_A)).rejects.toThrow(/API_KEY_PEPPER/);
    } finally {
      process.env.API_KEY_PEPPER = saved.pepper;
      if (saved.enc === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = saved.enc;
    }
  });
  it("still accepts a key stored with the old unpeppered hash, and rehashes it on that use", async () => {
    const row = db.apiKey.find((k) => k.id === "kA")!;
    row.hash = await legacyHashApiKey(KEY_A);
    const updateMany = prisma.apiKey as { updateMany: ReturnType<typeof vi.fn> };
    updateMany.updateMany.mockClear();
    const auth = await authenticate(req(KEY_A), "leads:read");
    expect(auth.ok).toBe(true);
    expect(updateMany.updateMany).toHaveBeenCalledWith({ where: { id: "kA", hash: await legacyHashApiKey(KEY_A) }, data: { hash: await hashApiKey(KEY_A) } });
    // A peppered key is never rehashed.
    row.hash = await hashApiKey(KEY_A);
    updateMany.updateMany.mockClear();
    await authenticate(req(KEY_A), "leads:read");
    expect(updateMany.updateMany.mock.calls.some((c) => "hash" in (c[0] as { data: object }).data)).toBe(false);
  });
  it("validates name and scopes", () => {
    expect(validateKeyInput({ name: "  Zapier  ", scopes: ["leads:read", "leads:read", "bogus"] })).toEqual({ name: "Zapier", scopes: ["leads:read"] });
    expect(() => validateKeyInput({ name: "", scopes: ["leads:read"] })).toThrow(ApiKeyError);
    expect(() => validateKeyInput({ name: "x", scopes: [] })).toThrow(/permission/);
  });
});

describe("authentication", () => {
  it("rejects a missing, malformed, unknown or revoked key with a JSON 401", async () => {
    for (const r of [req(null), req("not-a-key"), req("bp_live_unknown")]) {
      const response = await listLeads(r);
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("unauthorized");
    }
    db.apiKey.find((k) => k.id === "kA")!.revokedAt = new Date();
    expect((await listLeads(req(KEY_A))).status).toBe(401);
  });
  it("never stores or compares the raw key", async () => {
    expect(db.apiKey.every((k) => !JSON.stringify(k).includes("keyAAAA"))).toBe(true);
  });
  it("checks the scope: a read-only key cannot write", async () => {
    expect((await listLeads(req(KEY_READONLY))).status).toBe(200);
    const denied = await patchLead(req(KEY_READONLY, "https://x.test/api/v1/leads/a1", { method: "PATCH", body: JSON.stringify({ status: "won" }) }), ctxId("a1"));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("insufficient_scope");
    expect((await listProjects(req(KEY_READONLY))).status).toBe(403);
  });
  it("is Pro only on every call: a downgrade disables the keys without deleting them, an upgrade brings them back", async () => {
    expect((await listLeads(req(KEY_A))).status).toBe(200);
    db.business.find((b) => b.id === "bizA")!.user = { subscription: { plan: "STANDARD", status: "ACTIVE" } };
    const response = await listLeads(req(KEY_A));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("plan_required");
    expect(db.apiKey.some((k) => k.id === "kA")).toBe(true);
    db.business.find((b) => b.id === "bizA")!.user = { subscription: { plan: "PRO", status: "ACTIVE" } };
    expect((await listLeads(req(KEY_A))).status).toBe(200);
    db.business.find((b) => b.id === "bizA")!.user = { subscription: { plan: "PRO", status: "PAST_DUE" } };
    expect((await listLeads(req(KEY_A))).status).toBe(403);
  });
  it("rate limits per key: 60 a minute, answered with 429 and Retry-After", async () => {
    await listLeads(req(KEY_A));
    expect(rateLimit).toHaveBeenCalledWith("api-key:kA", API_RATE_LIMIT);
    expect(API_RATE_LIMIT).toEqual({ limit: 60, windowSeconds: 60 });
    rateLimit.mockRejectedValueOnce(new RateLimitError(42));
    const response = await listLeads(req(KEY_A));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect((await response.json()).error.code).toBe("rate_limited");
  });
  it("records last use", async () => {
    await authenticate(req(KEY_A), "leads:read");
    expect((prisma.apiKey as { updateMany: ReturnType<typeof vi.fn> }).updateMany).toHaveBeenCalled();
  });
});

describe("paging and filters", () => {
  it("parses limit and cursor strictly", () => {
    expect(parsePaging(new URLSearchParams(""))).toEqual({ limit: 25, cursor: null });
    expect(parsePaging(new URLSearchParams("limit=100&cursor=abc_1-2"))).toEqual({ limit: 100, cursor: "abc_1-2" });
    for (const q of ["limit=0", "limit=101", "limit=x", "cursor=a%20b", "cursor="]) expect(parsePaging(new URLSearchParams(q))).toHaveProperty("error");
    expect(pageArgs({ limit: 2, cursor: "x" })).toMatchObject({ take: 3, skip: 1, cursor: { id: "x" } });
    expect(toPage([{ id: "1" }, { id: "2" }, { id: "3" }], 2)).toEqual({ data: [{ id: "1" }, { id: "2" }], nextCursor: "2" });
    expect(toPage([{ id: "1" }], 2).nextCursor).toBeNull();
  });
  it("pages through leads newest first with a cursor, never repeating or skipping", async () => {
    const first = await (await listLeads(req(KEY_A, "https://x.test/api/v1/leads?limit=2"))).json();
    expect(first.data.map((l: { id: string }) => l.id)).toEqual(["a3", "a2"]);
    expect(first.nextCursor).toBe("a2");
    const second = await (await listLeads(req(KEY_A, `https://x.test/api/v1/leads?limit=2&cursor=${first.nextCursor}`))).json();
    expect(second.data.map((l: { id: string }) => l.id)).toEqual(["a1"]);
    expect(second.nextCursor).toBeNull();
  });
  it("filters by status (case-insensitive) and rejects unknown values", async () => {
    const won = await (await listLeads(req(KEY_A, "https://x.test/api/v1/leads?status=won"))).json();
    expect(won.data.map((l: { id: string }) => l.id)).toEqual(["a2"]);
    expect(won.data[0].status).toBe("won");
    expect((await listLeads(req(KEY_A, "https://x.test/api/v1/leads?status=maybe"))).status).toBe(400);
    expect((await listLeads(req(KEY_A, "https://x.test/api/v1/leads?limit=1000"))).status).toBe(400);
  });
});

describe("business A can never see or change business B", () => {
  it("lists only its own rows on every endpoint", async () => {
    const ids = async (response: Response) => (await response.json()).data.map((r: { id: string }) => r.id);
    expect(await ids(await listLeads(req(KEY_A)))).not.toContain("b1");
    expect(await ids(await listProjects(req(KEY_A, "https://x.test/api/v1/projects")))).toEqual(["kgA", "pA"]);
    expect(await ids(await listContent(req(KEY_A, "https://x.test/api/v1/content")))).toEqual(["cA"]);
    expect(await ids(await listPosts(req(KEY_A, "https://x.test/api/v1/posts")))).toEqual(["postA"]);
    expect(await ids(await listProducts(req(KEY_A, "https://x.test/api/v1/products")))).toEqual(["pA"]);
    expect(await ids(await listCampaigns(req(KEY_A, "https://x.test/api/v1/campaigns")))).toEqual(["kgA"]);
    expect(await ids(await listProjects(req(KEY_A, "https://x.test/api/v1/projects?type=event")))).toEqual(["kgA"]);
    expect(await ids(await listProjects(req(KEY_A, "https://x.test/api/v1/projects?type=product")))).toEqual(["pA"]);
    expect(await ids(await listLeads(req(KEY_B)))).toEqual(["b1"]);
  });
  it("lists products and campaigns together on the old /projects, newest first, and pages through both without gaps or repeats", async () => {
    db.product.push({ ...db.product[0], id: "pA2", createdAt: day(3), updatedAt: day(3) });
    db.campaign.push({ ...db.campaign[0], id: "kgA0", createdAt: day(2), updatedAt: day(2) }); // same time as kgA: the id breaks the tie (descending)
    const all = (await (await listProjects(req(KEY_A, "https://x.test/api/v1/projects"))).json()).data.map((r: { id: string; type: string }) => `${r.id}:${r.type}`);
    expect(all).toEqual(["pA2:product", "kgA0:event", "kgA:event", "pA:product"]);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const url: string = `https://x.test/api/v1/projects?limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const page: { data: { id: string }[]; nextCursor: string | null } = await (await listProjects(req(KEY_A, url))).json();
      seen.push(...page.data.map((r) => r.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["pA2", "kgA0", "kgA", "pA"]);
    expect((await listProjects(req(KEY_A, "https://x.test/api/v1/projects?cursor=pB"))).status).toBe(400); // another company's id
  });

  it("answers products and campaigns in their own shape, and old project ids through /projects/:id", async () => {
    const product = (await (await getProduct(req(KEY_A), ctxId("pA"))).json()).data;
    expect(product).toMatchObject({ id: "pA", kind: "physical", price: { model: "fixed", amountMinor: 15000, currency: "RWF", label: "15,000 RWF" }, sellingPoints: ["Local"], photoCount: 1 });
    const campaign = (await (await getCampaign(req(KEY_A), ctxId("kgA"))).json()).data;
    expect(campaign).toMatchObject({ id: "kgA", type: "event", startsOn: "2026-10-20", productIds: ["pA"] });
    expect((await (await getProject(req(KEY_A), ctxId("kgA"))).json()).data).toMatchObject({ id: "kgA", type: "event", title: "Open day", price: "Free entry" });
    expect((await getProduct(req(KEY_A), ctxId("pB"))).status).toBe(404);
    expect((await getCampaign(req(KEY_A), ctxId("kgB"))).status).toBe(404);
    expect((await listProducts(req(KEY_A, "https://x.test/api/v1/products?kind=car"))).status).toBe(400);
  });
  it("answers 404 for another business's id on every GET", async () => {
    expect((await getLead(req(KEY_A), ctxId("b1"))).status).toBe(404);
    expect((await getProject(req(KEY_A), ctxId("pB"))).status).toBe(404);
    expect((await getContent(req(KEY_A), ctxId("cB"))).status).toBe(404);
    expect((await getPost(req(KEY_A), ctxId("postB"))).status).toBe(404);
    expect((await getLead(req(KEY_A), ctxId("a1"))).status).toBe(200);
  });
  it("filters by another business's project id still return nothing of theirs", async () => {
    const content = await (await listContent(req(KEY_A, "https://x.test/api/v1/content?projectId=pB"))).json();
    expect(content.data).toEqual([]);
  });
  it("cannot PATCH another business's lead, and cannot attach a post to their project", async () => {
    const patch = await patchLead(req(KEY_A, "https://x.test/api/v1/leads/b1", { method: "PATCH", body: JSON.stringify({ status: "lost" }) }), ctxId("b1"));
    expect(patch.status).toBe(404);
    expect(db.lead.find((l) => l.id === "b1")!.status).toBe("NEW");
    const post = await createPost(req(KEY_A, "https://x.test/api/v1/posts", { method: "POST", body: JSON.stringify({ network: "instagram", text: "x", projectId: "pB" }) }));
    expect(post.status).toBe(404);
  });
  it("does not expose private storage paths", async () => {
    const project = await (await getProject(req(KEY_A), ctxId("pA"))).json();
    expect(JSON.stringify(project)).not.toContain("secret/path.jpg");
    expect(project.data.photoCount).toBe(1);
  });
});

describe("writes", () => {
  it("PATCH changes a lead's status and notes", async () => {
    const response = await patchLead(req(KEY_A, "https://x.test/api/v1/leads/a1", { method: "PATCH", body: JSON.stringify({ status: "Contacted", notes: " called them " }) }), ctxId("a1"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ id: "a1", status: "contacted", notes: "called them" });
  });
  it("PATCH rejects bad input as JSON 400", async () => {
    for (const body of [{ status: "nope" }, {}, { name: "x" }, "not json"]) {
      const response = await patchLead(req(KEY_A, "https://x.test/api/v1/leads/a1", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), ctxId("a1"));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
    }
  });
  it("gates writes by the resource's own feature: leads need website chat, posts need the calendar; reading stays open with apiAccess", async () => {
    db.business.find((b) => b.id === "bizA")!.user = { subscription: { plan: "API_ONLY", status: "ACTIVE" } };
    expect((await listLeads(req(KEY_A))).status).toBe(200);
    expect((await getLead(req(KEY_A, "https://x.test/api/v1/leads/a1"), ctxId("a1"))).status).toBe(200);
    expect((await listPosts(req(KEY_A, "https://x.test/api/v1/posts"))).status).toBe(200);
    const patch = await patchLead(req(KEY_A, "https://x.test/api/v1/leads/a1", { method: "PATCH", body: JSON.stringify({ status: "won" }) }), ctxId("a1"));
    expect(patch.status).toBe(403);
    expect((await patch.json()).error).toMatchObject({ code: "feature_required", message: expect.stringMatching(/^Website chat and leads is not part of your plan\. You can still read existing data/) });
    expect(db.lead.find((l) => l.id === "a1")!.status).toBe("NEW");
    const post = await createPost(req(KEY_A, "https://x.test/api/v1/posts", { method: "POST", body: JSON.stringify({ network: "linkedin", text: "Hello" }) }));
    expect(post.status).toBe(403);
    expect((await post.json()).error.code).toBe("feature_required");
    expect(db.post.filter((p) => p.businessId === "bizA")).toHaveLength(1);
  });
  it("answers 503 feature_unavailable, never 403, while the plan cannot be checked (a key is not 'not in your plan' during a catalog blip)", async () => {
    db.business.find((b) => b.id === "bizA")!.user = { subscription: { plan: "RW_CUSTOM", status: "ACTIVE" } }; // a plan the catalog does not have
    for (const call of [() => listLeads(req(KEY_A)), () => patchLead(req(KEY_A, "https://x.test/api/v1/leads/a1", { method: "PATCH", body: JSON.stringify({ status: "won" }) }), ctxId("a1"))]) {
      const response = await call();
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("feature_unavailable");
    }
    const denied = await apiFeatureDenied("bizA", "websiteChat");
    expect(denied?.status).toBe(503);
    expect((await denied!.json()).error.code).toBe("feature_unavailable");
  });
  it("POST /posts creates a draft only", async () => {
    const response = await createPost(req(KEY_A, "https://x.test/api/v1/posts", { method: "POST", body: JSON.stringify({ network: "linkedin", text: "Hello", hashtags: ["#a"], projectId: "pA" }) }));
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ network: "linkedin", status: "draft", text: "Hello", projectId: "pA" });
    expect(db.post.at(-1)).toMatchObject({ businessId: "bizA", status: "DRAFT" });
    expect((await createPost(req(KEY_A, "https://x.test/api/v1/posts", { method: "POST", body: JSON.stringify({ network: "myspace", text: "x" }) }))).status).toBe(400);
  });
  it("POST /posts follows the composer's draft rules: http(s) links only, cleaned hashtags, text limit, text required", async () => {
    const post = (body: object) => createPost(req(KEY_A, "https://x.test/api/v1/posts", { method: "POST", body: JSON.stringify({ network: "instagram", text: "ok", ...body }) }));
    for (const link of ["javascript:alert(1)", "ftp://x.com/a", "data:text/html,hi", "not a link"]) expect((await post({ link })).status).toBe(400);
    expect((await post({ text: "   " })).status).toBe(400);
    expect((await post({ text: "x".repeat(10_001) })).status).toBe(400);
    const ok = await post({ link: "https://example.com/a", hashtags: ["new", "#new", " big sale "] });
    expect(ok.status).toBe(201);
    expect((await ok.json()).data).toMatchObject({ link: "https://example.com/a", hashtags: ["#new", "#bigsale"] });
  });
});
