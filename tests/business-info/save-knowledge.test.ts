import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: vi.fn(async () => ({ id: "owner-1", actorId: "owner-1", role: "OWNER", businessId: "biz-1" })) }));
vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { onboardingStep: "onboarding_step" }, trackEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ buildObjectPath: vi.fn(), createSignedUploadUrl: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/return-server", () => ({ takeReturn: vi.fn(async () => "/dashboard") }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));

import { finishOnboarding, saveKnowledge } from "@/app/onboarding/actions";

// The essentials: hours, the head office and a phone number.
const hours = {
  faqs: [],
  openingHours: [{ days: ["mon" as const], open: "08:00", close: "18:00" }],
  locations: [{ kind: "head" as const, address: "KN 4 Avenue, Kigali" }],
  contacts: [{ type: "whatsapp" as const, value: "0791954277", country: "Rwanda" }],
};

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
  it("refuses to save without the essentials (the Brand page and step 4 share this action)", async () => {
    mocks.findUnique.mockResolvedValue({ country: "Rwanda", timezone: "Africa/Kigali" });
    const r = await saveKnowledge({ faqs: [], area: "Kigali" });
    expect(r).toMatchObject({ ok: false, fieldErrors: { "openingHours.form": expect.any(String), "locations.0.address": expect.any(String), "contacts.form": expect.any(String) } });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("finishOnboarding", () => {
  const ready = { id: "biz-1", description: "Bakery", audience: "Families", tone: "friendly", onboardedAt: null };
  it("can't finish without hours, head office and phone", async () => {
    mocks.findUnique.mockResolvedValue({ ...ready, knowledge: { faqs: [], hours: "Mon-Fri 8-18" } });
    const r = await finishOnboarding();
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/opening hours, head office address and a WhatsApp or phone number/) });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("finishes once they are saved", async () => {
    mocks.findUnique.mockResolvedValue({
      ...ready,
      knowledge: { faqs: [], openingHours: hours.openingHours, locations: hours.locations, contacts: [{ type: "phone", value: "+250791954277", primary: true }] },
    });
    await expect(finishOnboarding()).rejects.toThrow("redirect:/dashboard");
    expect(mocks.update).toHaveBeenCalled();
  });
});
