import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  createReview: vi.fn(),
  saveQuizVoice: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: vi.fn(async () => ({ id: "u1", role: "OWNER" })) }));
vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));
vi.mock("@/lib/knowledge/records", () => ({ createReview: mocks.createReview }));
vi.mock("@/lib/knowledge/interview-service", () => ({ saveQuizVoice: mocks.saveQuizVoice, approveProfile: vi.fn(), updateApprovedProfile: vi.fn(), answerStep: vi.fn(), startInterview: vi.fn(), stepBack: vi.fn(), InterviewInProgressError: class extends Error {} }));
vi.mock("@/lib/industries/server", () => ({ resolveIndustryChoice: vi.fn(async () => ({ industryId: "i1" })) }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { onboardingStep: "onboarding_step" }, trackEvent: vi.fn() }));
vi.mock("@/lib/storage", () => ({ buildObjectPath: vi.fn(), createSignedUploadUrl: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/return-server", () => ({ takeReturn: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { saveKnowledge } from "@/app/onboarding/actions";
import { approveVoice } from "@/app/dashboard/knowledge/interview/actions";
import { saveProfile } from "@/app/dashboard/knowledge/profile/actions";
import { createReview } from "@/app/dashboard/knowledge/reviews/actions";

// Placeholder business (fixtures use fake names and +250788000000-style phones).
const profile = { name: "Inzozi Bakery", industry: "food", industryOther: "", industryDescription: "We bake bread and cakes for families in Kigali", about: "We bake bread." };
const knowledge = {
  faqs: [],
  openingHours: [{ days: ["mon" as const], open: "08:00", close: "18:00" }],
  locations: [{ kind: "head" as const, address: "KN 4 Ave, Kigali" }],
  contacts: [{ type: "whatsapp" as const, value: "+250788000000", country: "Rwanda" }],
};
const review = { quote: "Great bread", customerName: "A.", source: "GOOGLE" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue({ id: "b1", industryId: null, knowledge: {}, country: "Rwanda", timezone: "Africa/Kigali" });
  mocks.update.mockResolvedValue({});
  mocks.createReview.mockResolvedValue("r1");
});

describe("quiet saves (the Business info quiz)", () => {
  it("save the same, without revalidating", async () => {
    expect(await saveProfile(profile, { quiet: true })).toEqual({ ok: true });
    expect(await saveKnowledge(knowledge, { quiet: true })).toEqual({ ok: true });
    expect(await approveVoice({ voice: "Warm." }, "quiz", [], { quiet: true })).toEqual({ ok: true });
    expect(await createReview(review, { quiet: true })).toEqual({ ok: true, reviewId: "r1" });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.saveQuizVoice).toHaveBeenCalledTimes(1);
    expect(mocks.createReview).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("the section forms still revalidate", async () => {
    await saveProfile(profile);
    await saveKnowledge(knowledge);
    await approveVoice({ voice: "Warm." }, "quiz", []);
    await createReview(review);
    const paths = mocks.revalidatePath.mock.calls.map((c) => c.join(" "));
    expect(paths).toEqual(expect.arrayContaining(["/dashboard layout", "/dashboard/knowledge/interview", "/dashboard/brand", "/dashboard/knowledge/reviews"]));
  });
});
