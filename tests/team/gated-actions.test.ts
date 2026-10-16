import { beforeEach, describe, expect, it, vi } from "vitest";

// These tests import large server modules inside the test (actions, the visuals service): the first import
// can take several seconds when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

// A Member who calls a settings action directly (not through the hidden button) is refused before anything is written.

const h = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: h.requireActiveUser }));
vi.mock("@/lib/db", () => ({ prisma: { business: { update: h.update, updateMany: h.update, findUnique: vi.fn() } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: {}, trackEvent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/return-server", () => ({ takeReturn: vi.fn() }));
vi.mock("@/lib/autopilot/manage", () => ({ saveSettings: vi.fn(), runAutopilotForUser: vi.fn(), approveAll: vi.fn(), removeGroup: vi.fn(), regenerateGroup: vi.fn() }));
vi.mock("@/lib/publishing/engine", () => ({ publishPostsNow: vi.fn() }));
vi.mock("@/lib/publishing/queries", () => ({ loadComposerContext: vi.fn() }));
vi.mock("@/lib/publishing/media", () => ({ signPaths: vi.fn() }));
vi.mock("@/lib/leads/settings", () => ({ saveEmailToggles: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn() }));

import { ForbiddenError } from "@/lib/team/roles";

const memberDenied = (permission?: string) => {
  if (permission) throw new ForbiddenError(permission as never);
  return { id: "owner", actorId: "m1", role: "MEMBER", businessId: "b1" };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireActiveUser.mockImplementation(async (permission?: string) => memberDenied(permission));
});

describe("brand, onboarding and welcome saves need the settings permission", () => {
  it("onboarding actions ask for settings and write nothing for a Member", async () => {
    const actions = await import("@/app/onboarding/actions");
    await expect(actions.saveOffer({ description: "x", audience: "y" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(actions.saveVoice({ tone: "friendly" } as never)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(actions.finishOnboarding()).rejects.toBeInstanceOf(ForbiddenError);
    expect(h.requireActiveUser).toHaveBeenCalledWith("settings");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("the welcome form needs settings too", async () => {
    const { saveOrganisation } = await import("@/app/welcome/actions");
    await expect(saveOrganisation({}, new FormData())).rejects.toBeInstanceOf(ForbiddenError);
    expect(h.requireActiveUser).toHaveBeenCalledWith("settings");
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe("company time zone and lead email settings are settings, not content", () => {
  it("a Member is refused in words by both time zone actions and the lead notification toggles", async () => {
    const cal = await import("@/app/dashboard/calendar/actions");
    expect(await cal.setTimezoneAction("Africa/Kigali")).toEqual({ ok: false, error: "Ask your company owner or an admin to do this." });
    expect(await cal.autoSetTimezoneAction("Africa/Kigali")).toEqual({ ok: false, error: "Ask your company owner or an admin to do this." });
    const leads = await import("@/app/dashboard/leads/actions");
    expect(await leads.saveToggles({ notifyInstant: false, notifyDaily: false })).toEqual({ ok: false, error: "Ask your company owner or an admin to do this." });
    expect(h.requireActiveUser).toHaveBeenCalledWith("settings", "throw");
  });
});

describe("gated actions answer a Member in words", () => {
  it("autopilot settings, the brand language and business details return a friendly error", async () => {
    const { saveAutopilotSettings } = await import("@/app/dashboard/autopilot/actions");
    expect(await saveAutopilotSettings({} as never)).toEqual({ ok: false, error: "Ask your company owner or an admin to do this." });
    const { saveContentLanguage } = await import("@/app/dashboard/brand/language-action");
    expect(await saveContentLanguage("English")).toEqual({ ok: false, error: "Ask your company owner or an admin to do this." });
    const { saveBusiness } = await import("@/app/dashboard/settings/actions");
    expect(await saveBusiness({}, new FormData())).toEqual({ error: "Ask your company owner or an admin to do this." });
    expect(h.update).not.toHaveBeenCalled();
  });
});
