import { beforeEach, describe, expect, it, vi } from "vitest";

// Every dashboard page runs getAppContext. Each database round trip is felt (about 240 ms from the test site's Mac),
// so the lookups that do not depend on each other must start together, not one after another.
const h = vi.hoisted(() => {
  const started: string[] = [];
  const later = <T>(name: string, value: T) => {
    started.push(name);
    let resolve!: () => void;
    const p = new Promise<T>((r) => (resolve = () => r(value)));
    h.waiting.push(resolve);
    return p;
  };
  const h = { started, waiting: [] as (() => void)[], later };
  return h;
});

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentUser: async () => ({ id: "u1", email: "owner@example.test", user_metadata: {} }) }));
vi.mock("@/lib/account", () => ({ ensureAccount: () => h.later("ensureAccount", true) }));
vi.mock("@/lib/team/company", () => ({ resolveCompany: () => h.later("company", { actorId: "u1", role: "OWNER", businessId: "b1", ownerId: "u1", ownerDeleting: false, ownerSuspended: false }) }));
vi.mock("@/lib/creators/auth", () => ({ isCreatorOnly: async () => false }));
vi.mock("@/lib/staff/heartbeat", () => ({ heartbeat: () => {} }));
vi.mock("@/lib/invoices/service", () => ({ openInvoiceOf: async () => null }));
vi.mock("@/lib/db", () => ({
  prisma: {
    business: { findUnique: () => h.later("business", { id: "b1", userId: "u1", name: "Test Salon", detailsCompletedAt: new Date(), onboardedAt: new Date(), logoUrl: "u1/logo.png", brandColors: [], tone: null, ceoName: null }) },
    user: { findUnique: () => h.later("account", { deletionScheduledFor: null, suspendedAt: null, name: "Owner" }) },
  },
}));
vi.mock("@/lib/usage", () => ({ getUsageSummary: () => h.later("usage", { subscription: { status: "TRIALING", plan: "BUSINESS", trialEndsAt: null, chosenPlan: null } }) }));
// companyEntitlements is cached per request (React cache): the fake keeps one answer per business the same way.
const plans = new Map<string, Promise<unknown>>();
vi.mock("@/lib/entitlements", () => ({
  companyEntitlements: (id: string) => {
    if (!plans.has(id)) plans.set(id, h.later("entitlements", { inPlan: new Set(), usable: new Set() }));
    return plans.get(id);
  },
}));
vi.mock("@/lib/storage", () => ({ signedLogoUrl: () => h.later("logo", "https://signed.example.test/logo.png") }));

import { getAppContext } from "@/components/app/context";

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Lets every lookup started so far finish, then waits a tick for the next ones to start. */
async function finishStarted() {
  h.waiting.splice(0).forEach((r) => r());
  await tick();
}

beforeEach(() => {
  plans.clear();
  h.started.length = 0;
  h.waiting.length = 0;
});

describe("getAppContext loads what every page needs in as few round trips as it can", () => {
  it("checks the account and finds the company together, then the business, usage, person and plan together, then the logo", async () => {
    const ctx = getAppContext();
    await tick();
    expect(h.started).toEqual(["ensureAccount", "company"]);
    await finishStarted();
    expect(h.started.slice(2).sort()).toEqual(["account", "business", "entitlements", "usage"]);
    await finishStarted();
    expect(h.started.slice(6)).toEqual(["logo"]);
    await finishStarted();
    const done = await ctx;
    expect(done).toMatchObject({ businessName: "Test Salon", logoUrl: "https://signed.example.test/logo.png", firstName: "Owner" });
  });
});
