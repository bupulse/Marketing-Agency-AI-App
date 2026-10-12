/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FakeDb } from "../admin/fake-db";

// Shared set-up for the journey tests: a catalog (Starter and Business, priced in each region), a sign-up that writes
// the rows ensureAccount would (the in-memory database has no nested creates), and small readers. Each journey file
// keeps its own vi.mock block (vi.mock is hoisted per file) and calls these with its database.

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
/** Monday 12 October 2026, 08:00 in Kigali. */
export const NOW = new Date("2026-10-12T06:00:00Z");
export const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const BASE_PLAN = { description: "", isTrial: false, trialDays: null, status: "active", highlight: false, currency: "USD", highlights: [], features: [], capabilities: {}, paddlePrices: [], syncState: "not_synced", syncError: null, paddleProductId: null, paddleYearlyPriceId: null, createdAt: NOW, updatedAt: NOW };

export const STARTER_FEATURES = ["content", "designs", "calendar", "gallery"];
export const BUSINESS_FEATURES = ["content", "designs", "calendar", "gallery", "websiteChat", "analytics", "webhooks", "apiAccess"];

/** Regions fall back to the seeds (RW, EAC, GLOBAL). Plans: Starter and Business; RW prices in RWF; EAC and GLOBAL use the plan's USD price. */
export function seedCatalog(db: FakeDb, opts: { availability?: boolean } = {}) {
  db.planDefinition.rows.push(
    { ...BASE_PLAN, id: "plan_starter", key: "STARTER", name: "Starter", sortOrder: 5, monthlyPriceCents: 2500, yearlyPriceCents: 25000, limits: { text: 60, image: 30, chat: 0, videoSeconds: 0, voiceCharacters: 0, seats: 1 }, featureKeys: STARTER_FEATURES, paddleMonthlyPriceId: "pri_starter_m" },
    { ...BASE_PLAN, id: "plan_business", key: "BUSINESS", name: "Business", sortOrder: 6, monthlyPriceCents: 4900, yearlyPriceCents: 49000, limits: { text: 200, image: 100, chat: 500, videoSeconds: 0, voiceCharacters: 0, seats: 3 }, featureKeys: BUSINESS_FEATURES, paddleMonthlyPriceId: "pri_business_m" },
  );
  db.planRegionPrice.rows.push(
    { id: "prp_starter_rw", planKey: "STARTER", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11600 },
    { id: "prp_business_rw", planKey: "BUSINESS", regionKey: "RW", currency: "RWF", monthlyMinor: 35000, yearlyMinor: 350000, cardMonthlyUsdCents: 2800, cardYearlyUsdCents: 27000 },
  );
  if (opts.availability !== false) for (const d of [1, 2, 3, 4, 5]) db.adminAvailability.rows.push({ id: `a${d}`, weekday: d, startMinute: 540, endMinute: 1020 });
}

/** The supabase user ensureAccount receives after email confirmation. */
export function authUser(n: number, country: string, now: Date = NOW) {
  return { id: UID(n), email: `owner${n}@example.com`, email_confirmed_at: now.toISOString(), user_metadata: { organisation_name: `Company ${n}`, ceo_name: `Owner ${n}`, industry: "Retail", country }, identities: [{ provider: "email" }] };
}

/**
 * Makes `user.upsert` write what the nested create of lib/account.ts would: the user, the business and the
 * subscription, linked the way the server code reads them (user.subscription, business.user).
 */
export function installSignUp(db: FakeDb) {
  db.user.upsert.mockImplementation((async ({ where, update, create }: { where: { id: string }; update: Record<string, any>; create: Record<string, any> }) => {
    const existing = db.user.rows.find((u) => u.id === where.id);
    if (existing) {
      Object.assign(existing, update);
      return { ...existing, business: { id: existing.business.id } };
    }
    const { business: b, subscription: s, ...userData } = create;
    const subscription: Record<string, any> = { id: `s_${userData.id}`, userId: userData.id, chosenPlan: null, interval: "MONTH", cancelAtPeriodEnd: false, provider: null, providerCustomerId: null, providerSubscriptionId: null, providerPriceId: null, trialReminder1SentAt: null, trialReminder2SentAt: null, ...s.create };
    const user: Record<string, any> = { ...userData, suspendedAt: null, subscription };
    const businessData = { ...b.create };
    delete businessData.memberships;
    const business: Record<string, any> = { id: `b_${userData.id}`, userId: userData.id, ...businessData, user };
    user.business = { id: business.id, name: business.name };
    db.subscription.rows.push(subscription);
    db.user.rows.push(user);
    db.business.rows.push(business);
    return { ...user, business: { id: business.id } };
  }) as never);
}

/** The rows of a signed-up company by auth user number. */
export function companyOf(db: FakeDb, n: number) {
  const user = db.user.rows.find((u) => u.id === UID(n))!;
  const business = db.business.rows.find((b) => b.userId === UID(n))!;
  const subscription = db.subscription.rows.find((s) => s.userId === UID(n))!;
  return { userId: UID(n), businessId: business.id as string, user, business, subscription };
}

export const code = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message: string }) => `${e.code ? `${e.code}: ` : ""}${e.message}`);
export const subjects = (calls: unknown[][]) => calls.map((c) => (c[0] as { subject: string }).subject);
export const recipients = (calls: unknown[][]) => calls.map((c) => (c[0] as { to: string }).to);
