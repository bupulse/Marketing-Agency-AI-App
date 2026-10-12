import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: vi.fn(async () => ({ id: "owner-1", actorId: "owner-1", role: "OWNER", businessId: "biz-1" })) }));
vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { onboardingStep: "onboarding_step" }, trackEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ buildObjectPath: vi.fn(), createSignedUploadUrl: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/return-server", () => ({ takeReturn: vi.fn() }));

import { saveKnowledge } from "@/app/onboarding/actions";

const hours = { faqs: [], openingHours: [{ days: ["mon" as const], open: "08:00", close: "18:00" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
});

describe("saveKnowledge", () => {
  it("sets the country's zone when the business is still on the default UTC", async () => {
    mocks.findUnique.mockResolvedValue({ country: "Rwanda", timezone: "UTC" });
    expect(await saveKnowledge(hours)).toEqual({ ok: true });
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ timezone: "Africa/Kigali", knowledge: { openingHours: hours.openingHours } });
  });
  it("keeps a zone that was already set, and UTC for countries without a single zone", async () => {
    mocks.findUnique.mockResolvedValue({ country: "Rwanda", timezone: "Europe/Brussels" });
    await saveKnowledge(hours);
    expect(mocks.update.mock.calls[0][0].data.timezone).toBeUndefined();
    mocks.findUnique.mockResolvedValue({ country: "United States", timezone: "UTC" });
    await saveKnowledge(hours);
    expect(mocks.update.mock.calls[1][0].data.timezone).toBeUndefined();
  });
  it("answers crafted input with a validation error and saves nothing", async () => {
    mocks.findUnique.mockResolvedValue({ country: "Rwanda", timezone: "UTC" });
    const r = await saveKnowledge({ hours: { evil: true }, contacts: 7 } as never);
    expect(r).toMatchObject({ ok: false, fieldErrors: { form: expect.stringMatching(/could not be read/) } });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
