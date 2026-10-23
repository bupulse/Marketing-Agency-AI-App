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
vi.mock("@/lib/account", () => ({ ensureAccount: async () => true }));
vi.mock("@/lib/team/company", () => ({ resolveCompany: async () => ({ actorId: "u1", role: "OWNER", businessId: "b1", ownerId: "u1", ownerDeleting: false, ownerSuspended: false }) }));
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
vi.mock("@/lib/entitlements", () => ({ companyEntitlements: () => h.later("entitlements", { inPlan: new Set(), usable: new Set() }) }));
vi.mock("@/lib/storage", () => ({ createSignedDownloadUrl: () => h.later("logo", "https://signed.example.test/logo.png") }));

import { getAppContext } from "@/components/app/context";

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Lets every lookup started so far finish, then waits a tick for the next ones to start. */
async function finishStarted() {
  h.waiting.splice(0).forEach((r) => r());
  await tick();
}

beforeEach(() => {
  h.started.length = 0;
  h.waiting.length = 0;
});

describe("getAppContext loads what every page needs in as few round trips as it can", () => {
  it("asks for the business, the usage and the person together, then the plan and the logo together", async () => {
    const ctx = getAppContext();
    await tick();
    expect(h.started).toEqual(["business", "usage", "account"]);
    await finishStarted();
    expect(h.started.slice(3).sort()).toEqual(["entitlements", "logo"]);
    await finishStarted();
    const done = await ctx;
    expect(done).toMatchObject({ businessName: "Test Salon", logoUrl: "https://signed.example.test/logo.png", firstName: "Owner" });
  });
});
