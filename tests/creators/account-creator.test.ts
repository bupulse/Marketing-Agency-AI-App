import { beforeEach, describe, expect, it, vi } from "vitest";

// ensureAccount (lib/account.ts) for a creator's own sign-up (/creators/signup, docs/CREATOR_MARKETPLACE.md): the User
// row and a CreatorProfile, never a Business, subscription, membership, sign-up event or referral. A company sign-up
// is unchanged.

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  track: vi.fn(),
  assignReferral: vi.fn(async () => false),
  assignPartnerReferral: vi.fn(async () => false),
  noteRegionMismatch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: h.findUnique, upsert: h.upsert } } }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { signup: "signup" }, trackEvent: h.track }));
vi.mock("@/lib/sales/referral", () => ({ assignReferral: h.assignReferral, refFromCookie: vi.fn(async () => null) }));
vi.mock("@/lib/partners/service", () => ({ assignPartnerReferral: h.assignPartnerReferral }));
vi.mock("@/lib/region", () => ({ regionFromCountryName: vi.fn(async () => "RW") }));
vi.mock("@/lib/region-check", () => ({ noteRegionMismatch: h.noteRegionMismatch }));
vi.mock("@/lib/industries/server", () => ({ getIndustries: vi.fn(async () => []), slugForIndustryName: () => null }));

import { ensureAccount } from "@/lib/account";

const creator = (over: Record<string, unknown> = {}) =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    email: "ana@example.com",
    email_confirmed_at: "2026-10-21T08:00:00Z",
    user_metadata: { account_kind: "creator", full_name: "Ana Uwase", phone: "0791 954 277" },
    identities: [{ provider: "email" }],
    ...over,
  }) as never;

beforeEach(() => {
  for (const f of [h.findUnique, h.upsert, h.track, h.assignReferral, h.assignPartnerReferral, h.noteRegionMismatch]) f.mockClear();
  h.findUnique.mockResolvedValue(null);
  h.upsert.mockImplementation(async ({ create }: { create: { id: string } }) => ({ ...create, business: null }));
});

describe("ensureAccount for a creator's sign-up", () => {
  it("makes the User row and a creator profile, with the WhatsApp number in E.164, and nothing of a company", async () => {
    expect(await ensureAccount(creator())).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
    const { create, update } = h.upsert.mock.calls[0][0];
    expect(create).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      email: "ana@example.com",
      name: "Ana Uwase",
      signUpMethod: "PASSWORD",
      creator: { create: { name: "Ana Uwase", phone: "+250791954277" } },
    });
    expect(create).not.toHaveProperty("business");
    expect(create).not.toHaveProperty("subscription");
    expect(update).toEqual({ email: "ana@example.com" });
    expect(h.track).not.toHaveBeenCalled();
    expect(h.assignReferral).not.toHaveBeenCalled();
    expect(h.assignPartnerReferral).not.toHaveBeenCalled();
    expect(h.noteRegionMismatch).not.toHaveBeenCalled();
  });

  it("names the profile after the email without a name, and keeps no unreadable phone", async () => {
    await ensureAccount(creator({ user_metadata: { account_kind: "creator", phone: "12" } }));
    expect(h.upsert.mock.calls[0][0].create.creator.create).toEqual({ name: "ana", phone: null });
  });

  it("makes nothing before the email is confirmed, and nothing again for a returning creator", async () => {
    expect(await ensureAccount(creator({ email_confirmed_at: null }))).toBe(false);
    h.findUnique.mockResolvedValue({ email: "ana@example.com" });
    expect(await ensureAccount(creator())).toBe(true);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("leaves a company sign-up as it was: a Business with its owner, a subscription waiting for the demo, the sign-up event", async () => {
    h.upsert.mockImplementation(async ({ create }: { create: { id: string } }) => ({ ...create, business: { id: "b1" } }));
    await ensureAccount(creator({ user_metadata: { organisation_name: "Leaf", ceo_name: "Owner", industry: "Retail", country: "Rwanda" } }));
    const { create } = h.upsert.mock.calls[0][0];
    expect(create).not.toHaveProperty("creator");
    expect(create.business.create).toMatchObject({ name: "Leaf", memberships: { create: { userId: "00000000-0000-4000-8000-000000000001", role: "OWNER" } } });
    expect(create.subscription.create).toMatchObject({ plan: "TRIAL", status: "PENDING_DEMO" });
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.assignReferral).toHaveBeenCalledTimes(1);
  });
});
