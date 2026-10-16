import { describe, expect, it } from "vitest";
import { buildPrompt, generateMarketingContent } from "@/lib/ai/marketing";
import { AIProviderError, type TextProvider } from "@/lib/ai/types";

const brand = { businessName: "Sunrise Bakery", industry: "Food", tone: "friendly" };
const input = { type: "product", title: "Sourdough loaf", price: "$8", features: ["slow fermented"] };

function fakeProvider(text: string): TextProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    name: "fake",
    prompts,
    async generate(request) {
      prompts.push(request.prompt);
      return { text, provider: "fake", model: "fake-1", usage: { inputTokens: 10, outputTokens: 20 } };
    },
  };
}

describe("generateMarketingContent", () => {
  it("normalises hashtags and keeps at most three headlines", async () => {
    const provider = fakeProvider(
      JSON.stringify({
        caption: "Fresh bread daily.",
        hashtags: ["bakery", "#sourdough"],
        videoScript: "0-5s: oven",
        adHeadlines: ["a", "b", "c", "d"],
      }),
    );
    const { content, provider: name, model, usage } = await generateMarketingContent(provider, brand, input);
    expect(content.hashtags).toEqual(["#bakery", "#sourdough"]);
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(content.adHeadlines).toEqual(["a", "b", "c"]);
    expect(name).toBe("fake");
    expect(model).toBe("fake-1");
  });

  it("puts the brand and promotion details in the prompt", async () => {
    const provider = fakeProvider(
      JSON.stringify({ caption: "c", hashtags: [], videoScript: "s", adHeadlines: ["h1", "h2", "h3"] }),
    );
    await generateMarketingContent(provider, brand, input);
    expect(provider.prompts[0]).toContain("Business: Sunrise Bakery");
    expect(provider.prompts[0]).toContain("Price or offer: $8");
    expect(provider.prompts[0]).toContain("- slow fermented");
  });

  it("puts the voice guide, language, audience and knowledge in the prompt", async () => {
    const provider = fakeProvider(
      JSON.stringify({ caption: "c", hashtags: [], videoScript: "s", adHeadlines: ["h1", "h2", "h3"] }),
    );
    await generateMarketingContent(
      provider,
      {
        ...brand,
        tone: "luxury",
        contentLanguage: "French",
        audience: "Families nearby",
        website: "https://sunrise.example",
        knowledge: { hours: "Mon-Sat 7-18", area: "Kigali", contact: "+250 788 000 000" },
      },
      { ...input, instruction: "mention free delivery" },
    );
    const prompt = provider.prompts[0];
    expect(prompt).toContain("Write all content in French");
    expect(prompt).toContain("Elegant, calm and refined");
    expect(prompt).toContain("Its customers: Families nearby");
    expect(prompt).toContain("Opening hours: Mon-Sat 7-18");
    expect(prompt).toContain("Contact: +250 788 000 000");
    expect(prompt).toContain("The owner asks: mention free delivery");
  });

  it("defaults to English", async () => {
    const provider = fakeProvider(
      JSON.stringify({ caption: "c", hashtags: [], videoScript: "s", adHeadlines: ["h1", "h2", "h3"] }),
    );
    await generateMarketingContent(provider, brand, input);
    expect(provider.prompts[0]).toContain("Write all content in English");
  });

  it("keeps ad headlines within 40 characters", async () => {
    const long = "A very long headline that goes on and on and on forever";
    const provider = fakeProvider(
      JSON.stringify({ caption: "c", hashtags: [], videoScript: "s", adHeadlines: [long, "b", "c"] }),
    );
    const { content } = await generateMarketingContent(provider, brand, input);
    expect(content.adHeadlines[0].length).toBeLessThanOrEqual(40);
  });

  it("asks for exactly three ad headlines", async () => {
    const provider = fakeProvider(JSON.stringify({ caption: "c", hashtags: [], videoScript: "s", adHeadlines: ["a", "b", "c"] }));
    await generateMarketingContent(provider, brand, input);
    expect(provider.prompts[0]).toContain("adHeadlines: exactly 3 different ad headlines");
    expect(provider.prompts[0]).not.toMatch(/2 or 3/);
  });

  it("fewer than three usable headlines is a failed answer (retryable, so the credit goes back)", async () => {
    for (const adHeadlines of [["only one"], ["Same", "same", "Other"], ["a", " ", "b"]]) {
      const provider = fakeProvider(JSON.stringify({ caption: "c", hashtags: [], videoScript: "s", adHeadlines }));
      const error = await generateMarketingContent(provider, brand, input).catch((e) => e);
      expect(error).toBeInstanceOf(AIProviderError);
      expect(error.retryable).toBe(true);
    }
  });

  it("throws a retryable AIProviderError for non-JSON output", async () => {
    const error = await generateMarketingContent(fakeProvider("not json"), brand, input).catch((e) => e);
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error.retryable).toBe(true);
  });

  it("throws when required fields are missing", async () => {
    const provider = fakeProvider(JSON.stringify({ caption: "only a caption" }));
    await expect(generateMarketingContent(provider, brand, input)).rejects.toBeInstanceOf(AIProviderError);
  });
});

describe("buildPrompt and the industry context", () => {
  it("puts the sector guidance and the owner's description in the prompt, replacing the bare industry line", () => {
    const context = "Industry: Shops & retail (Shops and boutiques.)\nAbout this business, in the owner's words: We sell kitenge dresses in Kigali.\nSector guidance (general knowledge about this kind of business, not facts about this one; use it for ideas, tone and timing, never as claims):\n- Avoid (words, claims, compliance): Never invent prices.";
    const withContext = buildPrompt({ ...brand, industryContext: context }, input);
    expect(withContext).toContain(context);
    expect(withContext).not.toContain("Industry: Food");
    expect(withContext.indexOf("Sector guidance")).toBeLessThan(withContext.indexOf("Promoting (product)"));
    const without = buildPrompt(brand, input);
    expect(without).toContain("Industry: Food");
    expect(without).not.toContain("Sector guidance");
  });
});
