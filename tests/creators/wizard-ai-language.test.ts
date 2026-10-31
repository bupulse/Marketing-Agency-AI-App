import { beforeEach, describe, expect, it, vi } from "vitest";

// The wizard's AI (lib/creators/wizard-ai.ts, feature "creatorWizard") for the one-page form: it is told the campaign's
// language and reads the owner's description, and the product typed on the form. No real AI is called.

const h = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    business: { findUnique: vi.fn(async () => ({ name: "LEAF", industry: "Juice bar", description: null, industryDescription: null, audience: null, country: "Rwanda", tone: null, contentLanguage: "English", instagramHandle: "leafjuice", website: null, marketingProfile: null })) },
    product: { findMany: vi.fn(async () => []) },
    campaign: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    aiCall: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ generate: h.generate }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, run: () => Promise<unknown>) => run(), withLateTimeout: (p: Promise<unknown>) => p }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/creators/campaigns", () => ({ campaignLimits: vi.fn(async () => ({ liveCampaigns: 2, creatorsPerCampaign: 20 })), defaultCurrency: vi.fn(async () => "RWF") }));

import { suggestCampaign } from "@/lib/creators/wizard-ai";

const ACTOR = { actorId: "u1", businessId: "b1", role: "OWNER" as const };

beforeEach(() => {
  vi.stubEnv("AI_TEXT_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  h.generate.mockReset();
  h.generate.mockResolvedValue({ text: JSON.stringify({ name: "Umutobe wa LEAF", brief: "Fata amashusho unywa umutobe wacu wa passion mu rugo.", tasks: [{ title: "Video ya mbere", instructions: "Erekana umutobe mu masegonda 3 ya mbere." }] }), provider: "gemini", model: "m", usage: {} });
});

describe("the one-page form's AI", () => {
  it("writes in the campaign's language, from the owner's description and product", async () => {
    const description = "Film yourself trying our passion juice at home. One video a week. Use #LeafJuice.";
    const s = await suggestCampaign(ACTOR, { step: "all", answers: { idea: description, language: "rw", productName: "Passion juice", platforms: ["instagram"] }, tiktokReady: false });
    const { prompt, system } = h.generate.mock.calls[0][0] as { prompt: string; system: string };
    expect(prompt).toContain("THE CAMPAIGN'S LANGUAGE: Kinyarwanda. Write the name, the brief, the tasks, the do's and don'ts and the form questions in Kinyarwanda");
    expect(prompt).toContain(description);
    expect(prompt).toContain('"productsPromoted":[{"name":"Passion juice"}]');
    expect(system).toContain("in the campaign's language");
    expect(prompt).toContain("at least 500 RWF");
    expect(s).toMatchObject({ source: "ai", name: "Umutobe wa LEAF", brief: "Fata amashusho unywa umutobe wacu wa passion mu rugo." });
  });

  it("is English when no language is given (the old wizard)", async () => {
    await suggestCampaign(ACTOR, { step: "all", answers: { idea: "Film our juice" }, tiktokReady: false });
    expect((h.generate.mock.calls[0][0] as { prompt: string }).prompt).toContain("THE CAMPAIGN'S LANGUAGE: English. Write the name, the brief, the tasks, the do's and don'ts and the form questions in English.");
  });

  it("falls back to the template when the AI fails, so the form always works", async () => {
    h.generate.mockRejectedValue(new Error("down"));
    const s = await suggestCampaign(ACTOR, { step: "all", answers: { idea: "Film our juice", language: "fr" }, tiktokReady: false });
    expect(s.source).toBe("template");
  });
});
